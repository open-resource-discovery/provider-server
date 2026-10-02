import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// @testing-library/react only auto-cleans when Vitest globals are enabled. This harness
// keeps globals off (tests import describe/it/expect explicitly), so unmount rendered
// trees between tests by hand to prevent cross-test DOM leakage.
afterEach((): void => {
  cleanup();
});
