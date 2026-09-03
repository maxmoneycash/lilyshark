// esp-web-tools custom element type declaration.
// jsx: react-jsx resolves JSX through the React module's namespace, so the
// augmentation has to target 'react' — a bare global `namespace JSX` block in
// a module file is module-local and never merges.
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'esp-web-install-button': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        manifest?: string
      }
    }
  }
}

export {}
