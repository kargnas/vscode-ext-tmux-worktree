const typescriptParser = require("@typescript-eslint/parser");
const typescriptPlugin = require("@typescript-eslint/eslint-plugin");
const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
    js.configs.recommended,
    {
        files: ["src/**/*.ts"],
        languageOptions: {
            parser: typescriptParser,
            parserOptions: {
                ecmaVersion: 2020,
                sourceType: "module",
            },
            globals: {
                ...globals.node,
            }
        },
        plugins: {
            "@typescript-eslint": typescriptPlugin,
        },
        rules: {
            ...typescriptPlugin.configs.recommended.rules,
            "@typescript-eslint/no-unused-vars": "warn",
            "@typescript-eslint/no-explicit-any": "warn",
            "no-empty": "warn",
        },
    },
    {
        ignores: ["out/", "dist/", "**/*.d.ts"],
    }
];
