import type { ReactElement } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

// Smoke test proving the full ui/ toolchain is wired: TSX transform (plugin-react),
// the jsdom environment, and @testing-library rendering. The real hook tests land in
// the next ticket; this only asserts the harness itself runs green.
function Harness(): ReactElement {
  return <p>harness ok</p>;
}

describe("ui vitest harness", () => {
  it("renders a component into jsdom", (): void => {
    render(<Harness />);
    expect(screen.getByText("harness ok")).not.toBeNull();
  });
});
