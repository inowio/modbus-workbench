import type { ComponentProps } from "react";

import { useLiveRegister, type LiveStore } from "./liveValues";
import RegisterInspector from "./RegisterInspector";
import type { PageRegister } from "./useSimulatorData";
import { useValueHistory } from "./useValueHistory";

type InspectorProps = ComponentProps<typeof RegisterInspector>;

export type LiveRegisterInspectorProps = Omit<
  InspectorProps,
  "history" | "liveValue" | "liveRaw" | "liveWords" | "sourceStatus"
> & {
  live: LiveStore;
  /** The saved register (not the draft) whose live value the panel shows. */
  selected: PageRegister | null;
};

/** RegisterInspector wired to the live store, so value events re-render only this subtree. */
export default function LiveRegisterInspector({ live, selected, ...rest }: LiveRegisterInspectorProps) {
  const view = useLiveRegister(live, selected);
  const history = useValueHistory(live, selected);
  return (
    <RegisterInspector
      {...rest}
      history={history}
      liveValue={selected ? view.text : "—"}
      liveRaw={selected ? view.raw : null}
      liveWords={selected ? view.words : null}
      sourceStatus={selected ? view.sourceStatus : undefined}
    />
  );
}
