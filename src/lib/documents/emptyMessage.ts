// Message for the Documents list when the household has documents but the
// current tab and type filter match none of them. With no type chip selected
// on the Filed tab, this used to read "No undefined documents yet."
export function documentsEmptyMessage(type: string | undefined, showAll: boolean): string {
  if (type) {
    return `No ${type.toLowerCase()} documents yet.`;
  }
  return showAll ? "No documents yet." : "No filed documents yet.";
}
