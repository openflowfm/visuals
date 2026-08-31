import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Where a throw is allowed to stop.
 *
 * React unmounts the whole tree from an uncaught render error, and the whole
 * tree here includes **the canvas**. So a bug in a designer that nobody on the
 * wall can see — a node face reading a field a hand-edited flow does not have —
 * took the picture down with it and left a blank page, mid-set, with no way back
 * but a reload.
 *
 * Two of these, and the placement is the whole idea. One wraps the authoring
 * subtree, which is the code most likely to throw and the code least entitled to
 * take anything with it: it stops there, the canvas under it goes on drawing,
 * and `e` or Escape closes the console and gives the picture back. One wraps
 * everything, because a boundary that catches nothing is still what turns a
 * blank page into a sentence and a button.
 *
 * The console's window is never the projector's — the wall is a second window
 * that mounts no console at all — so a message here can take the whole screen
 * without anything being thrown at an audience.
 */
interface Props {
  children: ReactNode;
  /** What this boundary is protecting, shown in the message. */
  what: string;
  /** Draw nothing rather than a message — the wall must never show one. */
  quiet?: boolean;
}

interface State {
  message: string | null;
}

export class Boundary extends Component<Props, State> {
  override state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: (error as Error)?.message || 'something threw with no message' };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(`visuals: ${this.props.what} threw`, error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.message === null) return this.props.children;
    if (this.props.quiet) return null;
    return (
      <div className="boundary">
        <p>{this.props.what} stopped.</p>
        <p className="boundary-why">{this.state.message}</p>
        <button type="button" onClick={() => this.setState({ message: null })}>
          try again
        </button>
        <button type="button" onClick={() => location.reload()}>
          reload
        </button>
      </div>
    );
  }
}
