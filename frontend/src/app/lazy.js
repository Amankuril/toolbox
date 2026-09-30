/** Route helper: code-split a page module whose default export is the component. */
export const page = (loader) => ({
  lazy: async () => ({ Component: (await loader()).default }),
})
