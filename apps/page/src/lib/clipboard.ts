export const copyText = async (value: string) => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // HTTP pages and denied clipboard permissions use the selection fallback.
    }
  }

  const previous = document.activeElement;
  const selection = document.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) =>
        selection.getRangeAt(index).cloneRange(),
      )
    : [];
  const input = document.createElement("textarea");
  input.value = value;
  input.readOnly = true;
  input.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
  document.body.append(input);

  try {
    input.select();
    input.setSelectionRange(0, value.length);
    if (
      typeof document.execCommand !== "function" ||
      !document.execCommand("copy")
    )
      throw new Error("复制失败，请选中地址手动复制");
  } finally {
    input.remove();
    if (previous instanceof HTMLElement)
      previous.focus({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
  }
};
