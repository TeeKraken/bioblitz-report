/**
 * Only the latest import may change the page. Each file or sample load takes a
 * new token; when an older load finishes (or fails) after a newer one started,
 * its result and its error are both dropped.
 */
export function createImporter<T>(handlers: { commit(result: T): void; fail(err: unknown): void }) {
  let latest = 0;
  return {
    /** Starts an import. Resolves true if this import's result (or error) was used. */
    async run(load: () => Promise<T>): Promise<boolean> {
      const token = ++latest;
      let result: T;
      try {
        result = await load();
      } catch (err) {
        if (token !== latest) return false;
        handlers.fail(err);
        return true;
      }
      if (token !== latest) return false;
      handlers.commit(result);
      return true;
    },
  };
}
