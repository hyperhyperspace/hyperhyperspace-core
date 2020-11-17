@ECHO OFF
setx NODE_PATH "dist-examples/src;dist-examples/examples/chat" > $null
@ECHO ON

echo ${NODE_PATH}

node ./dist-examples/examples/chat/index.js