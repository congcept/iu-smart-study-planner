export function dropFocusToBody() {
  const previous = document.body.getAttribute('tabindex');
  document.body.setAttribute('tabindex', '-1');
  try {
    document.body.focus();
    document.body.blur();
  } finally {
    if (previous === null) document.body.removeAttribute('tabindex');
    else document.body.setAttribute('tabindex', previous);
  }
}
