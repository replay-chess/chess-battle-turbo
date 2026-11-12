// Server-side class strings for a link that looks like the DS primary button (md). `buttonVariants`
// (components/ui/button) lives in a client module, so a server component cannot call it; these are the same classes,
// kept in step by primary-link.test.ts. (Moved from the former React /r page, FIX-2.)
export const PRIMARY_LINK =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-none text-sm transition-colors duration-150 select-none cursor-pointer [-webkit-tap-highlight-color:transparent] [&_svg]:size-4 [&_svg]:shrink-0 bg-cb-accent text-cb-accent-fg font-medium px-4.5 hover:bg-cb-accent-hover min-h-11 no-underline";
