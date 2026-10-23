/** The .tdrec path among an app's command-line arguments (file association on Windows/Linux). */
export const projectArg = (argv: string[]): string | undefined => argv.slice(1).find((a) => !a.startsWith("-") && /\.tdrec$/i.test(a));
