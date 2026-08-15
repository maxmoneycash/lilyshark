// WebTUI Custom Elements Type Declarations
declare namespace JSX {
  interface IntrinsicElements {
    column: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      'box-'?: 'square' | 'round' | 'double' | string
      'pad-'?: string
      'gap-'?: string
      'align-'?: string
      'self-'?: string
    }
    row: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      'box-'?: 'square' | 'round' | 'double' | string
      'pad-'?: string
      'gap-'?: string
      'align-'?: string
      'self-'?: string
    }
    view: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      'pad-'?: string
      'gap-'?: string
    }
  }
}

declare module 'react' {
  interface HTMLAttributes<T> {
    'box-'?: 'square' | 'round' | 'double' | string
    'shear-'?: 'top' | 'bottom' | 'both' | string
    'is-'?: 'badge' | 'separator' | 'button' | 'table' | 'pre' | 'progress' | 'spinner' | string
    'pad-'?: string
    'gap-'?: string
    'align-'?: 'center' | 'between' | 'start' | 'end' | string
    'self-'?: string
    'variant-'?: 'accent' | 'green' | 'blue' | 'yellow' | 'red' | 'root' | 'background0' | 'background1' | 'background2' | string
    'size-'?: 'half' | string
    'cap-'?: string
    'direction-'?: 'x' | 'y' | string
  }
}

export {}
