import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api';
import {
  beginAuthenticationGeneration,
  bindRequestAuthentication,
  isAuthRequest,
  isRequestAuthenticationCurrent,
  notifySessionExpired,
  onSessionExpired,
} from '../sessionExpiry';

const originalAdapter = apiClient.defaults.adapter;

function replyWith(status: number) {
  apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    // A custom adapter owns its own rejection; axios only applies settle() to
    // its built-in adapters.
    const response = {
      data: { success: false, error: 'Unauthorized' },
      status,
      statusText: 'Unauthorized',
      headers: {},
      config,
    } as AxiosResponse;
    throw new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, undefined, response);
  };
}

afterEach(() => {
  apiClient.defaults.adapter = originalAdapter;
});

describe('expired session reporting', () => {
  it('survives subscriber churn so a remounted app is still told', () => {
    const seen = vi.fn();
    const off = onSessionExpired(seen);
    notifySessionExpired();
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    notifySessionExpired();
    expect(seen).toHaveBeenCalledTimes(1);

    // A second mount must be told too, not just the first subscriber.
    const again = vi.fn();
    const offAgain = onSessionExpired(again);
    notifySessionExpired();
    offAgain();
    expect(again).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('tells the app a refused read ended the session but a refused sign-in did not', () => {
    const seen = vi.fn();
    const off = onSessionExpired(seen);
    replyWith(401);

    // Ownership of a rejected sign-in belongs to the form, not to the session.
    expect(isAuthRequest('/auth/login')).toBe(true);
    expect(isAuthRequest('/auth/me')).toBe(true);
    expect(isAuthRequest('/users/me/grades')).toBe(false);
    expect(isAuthRequest(undefined)).toBe(false);

    return (async () => {
      await expect(apiClient.get('/users/me/grades')).rejects.toBeTruthy();
      expect(seen).toHaveBeenCalledTimes(1);

      await expect(apiClient.post('/auth/login', {})).rejects.toBeTruthy();
      expect(seen).toHaveBeenCalledTimes(1);

      replyWith(404);
      await expect(apiClient.get('/users/me/grades')).rejects.toBeTruthy();
      expect(seen).toHaveBeenCalledTimes(1);
      off();
    })();
  });
});

describe('the session generation', () => {
  it('treats a request that never recorded a generation as current', () => {
    expect(isRequestAuthenticationCurrent({})).toBe(true);
  });

  it('answers the same way twice for the same request', () => {
    const config = {};
    bindRequestAuthentication(config);
    beginAuthenticationGeneration();
    // The request belongs to an earlier session, and reading it twice must not
    // change the answer.
    expect(isRequestAuthenticationCurrent(config)).toBe(false);
    expect(isRequestAuthenticationCurrent(config)).toBe(false);
  });

  it('does not treat a request from an earlier session as current', () => {
    const config = {};
    bindRequestAuthentication(config);
    beginAuthenticationGeneration();
    expect(isRequestAuthenticationCurrent(config)).toBe(false);
  });
});
