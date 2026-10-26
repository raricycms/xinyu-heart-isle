import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    /*
     * 只收 `src/` 下的测试。
     *
     * 原来还有一条 scripts 目录下的 test glob —— 实测 scripts/ 下
     * **一个 test 文件都没有**（0 个），是条永远匹配不到东西的 glob。
     * 死 glob 的危害不在于它不干活，而在于让人以为「scripts 里的测试也会被跑」，
     * 从而在 scripts/ 下写测试然后发现压根没执行。
     *
     * 如果以后真要在 scripts/ 下写测试，再加回来。
     */
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    reporters: 'default',
  },
});
