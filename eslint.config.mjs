import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // static files, the About page's script among them
    "public/**",
  ]),
  // the page's images are posters and logos at the sizes their sources give, sized by style.css as on the earlier page
  { files: ["src/ui/**"], rules: { "@next/next/no-img-element": "off" } },
  // a rest pattern that drops fields ({ alt, ...t }) names what it drops
  { rules: { "@typescript-eslint/no-unused-vars": ["warn", { ignoreRestSiblings: true }] } },
]);

export default eslintConfig;
