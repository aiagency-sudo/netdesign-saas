import nextConfig from "eslint-config-next";

const eslintConfig = [...nextConfig, { ignores: [".next/**", "next-env.d.ts"] }];

export default eslintConfig;
