import { afterEach, expect, it, vi } from 'vitest';
import apiClient, { importStudentProgress } from '../api';

const originalAdapter = apiClient.defaults.adapter;
afterEach(() => {
  apiClient.defaults.adapter = originalAdapter;
  vi.unstubAllGlobals();
});

const completed = '00000000-0000-4000-8000-000000000001';
const planned = '00000000-0000-4000-8000-000000000002';
const selections = { completedIds: { [completed]: 'Group 2' }, plannedIds: [planned] };

it('posts only selections to the current cookie account and returns the authoritative snapshot', async () => {
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new Error('Do not read bearer tokens');
    },
  });
  const confirmed = { completedIds: { [completed]: 'Group 1' }, plannedIds: [] };
  apiClient.defaults.adapter = async (config) => {
    expect(config.url).toBe('/users/me/progress');
    expect(config.method).toBe('post');
    expect(config.withCredentials).toBe(true);
    expect(config.headers.get('Authorization')).toBeUndefined();
    expect(JSON.parse(config.data)).toEqual(selections);
    return {
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: { success: true, data: confirmed },
    };
  };
  expect(await importStudentProgress(selections)).toEqual(confirmed);
});

it('does not treat an API error envelope as a confirmed import', async () => {
  apiClient.defaults.adapter = async (config) => ({
    config,
    status: 200,
    statusText: 'OK',
    headers: {},
    data: { success: false, error: 'Import rejected' },
  });
  await expect(importStudentProgress(selections)).rejects.toThrow('Import rejected');
});
