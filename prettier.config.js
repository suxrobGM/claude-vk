/**
 * @see https://prettier.io/docs/configuration
 * @type {import("prettier").Config}
 */
const config = {
  printWidth: 100,
  useTabs: false,
  tabWidth: 2,
  trailingComma: "all",
  semi: true,
  singleQuote: false,
  bracketSpacing: true,
  arrowParens: "always",
  jsxSingleQuote: false,
  bracketSameLine: false,
  endOfLine: "lf",
  plugins: ["@ianvs/prettier-plugin-sort-imports"],
  importOrder: ["<BUILTIN_MODULES>", "<THIRD_PARTY_MODULES>", "^@/(.*)$", "^[./]"],
  importOrderParserPlugins: ["typescript", "jsx", "decorators-legacy"],
  importOrderTypeScriptVersion: "5.0.0",
  overrides: [
    {
      files: ["*.jsx", "*.tsx"],
      options: {
        importOrder: [
          "<BUILTIN_MODULES>",
          "^(react/(.*)$)|^(react$)",
          "<THIRD_PARTY_MODULES>",
          "^@/(.*)$",
          "^[./]",
        ],
      },
    },
    {
      files: ["*.hbs"],
      options: {
        parser: "glimmer",
      },
    },
  ],
};

export default config;
