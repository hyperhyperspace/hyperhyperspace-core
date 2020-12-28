@ECHO OFF
setx NODE_PATH "dist-examples/src;dist-examples/examples/social" > NUL
@ECHO ON

node ./dist-examples/examples/social/index.js