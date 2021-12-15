import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';


export default {
    input: 'dist-browser/index.js',
    output: {
      file: 'dist-browser/hhs.js',
      format: 'iife',
      name: 'HHS'
    },
    plugins: [commonjs(), nodeResolve({preferBuiltins: false})],
    

};