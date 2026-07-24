/** Turns a project name into a filesystem/URL-safe filename stem, used by every project download route (.vsdx, HLD, configs). */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "design"
  );
}
