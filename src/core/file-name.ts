export function cleanFileName(title: string): string {
  // Remove Windows-reserved filename characters, wiki-link delimiters, and C0 controls.
  return title.replace(/[\\/:*?"<>|#^[\]\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim();
}
