@ECHO OFF
setx NODE_PATH "dist-examples/src;dist-examples/examples/chat" > NUL
@ECHO ON

node ./dist-examples/examples/chat/index.js