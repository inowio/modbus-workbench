import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const writeTextMock = vi.fn();
const readTextMock = vi.fn();

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: (...args: unknown[]) => writeTextMock(...args),
  readText: (...args: unknown[]) => readTextMock(...args),
}));

import EditableContextMenu from "./EditableContextMenu";

function renderWithInput(initialValue = "hello world") {
  const result = render(
    <>
      <input data-testid="text-input" defaultValue={initialValue} />
      <EditableContextMenu />
    </>,
  );
  return {
    ...result,
    input: screen.getByTestId("text-input") as HTMLInputElement,
  };
}

function renderWithTextarea(initialValue = "line one\nline two") {
  const result = render(
    <>
      <textarea data-testid="textarea" defaultValue={initialValue} />
      <EditableContextMenu />
    </>,
  );
  return {
    ...result,
    textarea: screen.getByTestId("textarea") as HTMLTextAreaElement,
  };
}

describe("EditableContextMenu", () => {
  beforeEach(() => {
    writeTextMock.mockReset();
    readTextMock.mockReset();
  });

  it("does not render anything initially", () => {
    renderWithInput();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens on right-click of an editable input", () => {
    const { input } = renderWithInput();
    fireEvent.contextMenu(input, { clientX: 50, clientY: 50 });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Cut/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Copy/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Paste/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Delete/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Select All/ })).toBeInTheDocument();
  });

  it("opens on right-click of a textarea", () => {
    const { textarea } = renderWithTextarea();
    fireEvent.contextMenu(textarea, { clientX: 10, clientY: 10 });
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("does not open on non-editable elements", () => {
    render(
      <>
        <div data-testid="plain-div">just text</div>
        <EditableContextMenu />
      </>,
    );
    fireEvent.contextMenu(screen.getByTestId("plain-div"), { clientX: 10, clientY: 10 });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("does not open on a readonly input", () => {
    render(
      <>
        <input data-testid="ro-input" defaultValue="locked" readOnly />
        <EditableContextMenu />
      </>,
    );
    fireEvent.contextMenu(screen.getByTestId("ro-input"), { clientX: 10, clientY: 10 });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("does not open on a disabled input", () => {
    render(
      <>
        <input data-testid="d-input" defaultValue="off" disabled />
        <EditableContextMenu />
      </>,
    );
    fireEvent.contextMenu(screen.getByTestId("d-input"), { clientX: 10, clientY: 10 });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("does not open on a non-text input like checkbox", () => {
    render(
      <>
        <input data-testid="cb" type="checkbox" />
        <EditableContextMenu />
      </>,
    );
    fireEvent.contextMenu(screen.getByTestId("cb"), { clientX: 10, clientY: 10 });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Escape", () => {
    const { input } = renderWithInput();
    fireEvent.contextMenu(input, { clientX: 10, clientY: 10 });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on outside mousedown", () => {
    const { input } = renderWithInput();
    fireEvent.contextMenu(input, { clientX: 10, clientY: 10 });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("disables Cut, Copy, Delete when there is no selection", () => {
    const { input } = renderWithInput();
    input.setSelectionRange(0, 0);
    fireEvent.contextMenu(input, { clientX: 10, clientY: 10 });
    expect(screen.getByRole("menuitem", { name: /Cut/ })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /Copy/ })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /Delete/ })).toBeDisabled();
  });

  it("enables Cut, Copy, Delete when there is a selection", () => {
    const { input } = renderWithInput();
    input.focus();
    input.setSelectionRange(0, 5);
    fireEvent.contextMenu(input, { clientX: 10, clientY: 10 });
    expect(screen.getByRole("menuitem", { name: /Cut/ })).not.toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /Copy/ })).not.toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /Delete/ })).not.toBeDisabled();
  });

  it("disables Select All when the input is empty", () => {
    const { input } = renderWithInput("");
    fireEvent.contextMenu(input, { clientX: 10, clientY: 10 });
    expect(screen.getByRole("menuitem", { name: /Select All/ })).toBeDisabled();
  });

  it("Copy writes the selected slice to the system clipboard", async () => {
    writeTextMock.mockResolvedValue(undefined);
    const { input } = renderWithInput("hello world");
    input.focus();
    input.setSelectionRange(0, 5);
    fireEvent.contextMenu(input, { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole("menuitem", { name: /Copy/ }));
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("hello");
    });
    // Menu closes after the action
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("Cut writes the selection and removes it from the input", async () => {
    writeTextMock.mockResolvedValue(undefined);
    const { input } = renderWithInput("hello world");
    input.focus();
    input.setSelectionRange(0, 6); // "hello "
    fireEvent.contextMenu(input, { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole("menuitem", { name: /Cut/ }));
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("hello ");
      expect(input.value).toBe("world");
    });
  });

  it("Paste inserts the clipboard contents at the cursor", async () => {
    readTextMock.mockResolvedValue("FOO ");
    const { input } = renderWithInput("hello world");
    input.focus();
    input.setSelectionRange(6, 6); // caret before "world"
    fireEvent.contextMenu(input, { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole("menuitem", { name: /Paste/ }));
    await waitFor(() => {
      expect(readTextMock).toHaveBeenCalled();
      expect(input.value).toBe("hello FOO world");
    });
  });

  it("Paste replaces the selection when one is active", async () => {
    readTextMock.mockResolvedValue("HI");
    const { input } = renderWithInput("hello world");
    input.focus();
    input.setSelectionRange(0, 5); // "hello" selected
    fireEvent.contextMenu(input, { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole("menuitem", { name: /Paste/ }));
    await waitFor(() => {
      expect(input.value).toBe("HI world");
    });
  });

  it("Delete removes the selection without touching the clipboard", () => {
    const { input } = renderWithInput("hello world");
    input.focus();
    input.setSelectionRange(0, 6); // "hello "
    fireEvent.contextMenu(input, { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete/ }));
    expect(input.value).toBe("world");
    expect(writeTextMock).not.toHaveBeenCalled();
  });

  it("Select All selects the entire value", () => {
    const { input } = renderWithInput("abcdef");
    fireEvent.contextMenu(input, { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole("menuitem", { name: /Select All/ }));
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(6);
  });

  it("survives a clipboard read failure without crashing", async () => {
    readTextMock.mockRejectedValue(new Error("denied"));
    const { input } = renderWithInput("hello");
    input.focus();
    input.setSelectionRange(0, 0);
    fireEvent.contextMenu(input, { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole("menuitem", { name: /Paste/ }));
    // Menu should close; value should be unchanged
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(input.value).toBe("hello");
  });

  it("survives a clipboard write failure without mutating the input", async () => {
    writeTextMock.mockRejectedValue(new Error("denied"));
    const { input } = renderWithInput("hello world");
    input.focus();
    input.setSelectionRange(0, 5);
    fireEvent.contextMenu(input, { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole("menuitem", { name: /Cut/ }));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    // Cut should not have deleted the text since the clipboard write failed
    expect(input.value).toBe("hello world");
  });
});
