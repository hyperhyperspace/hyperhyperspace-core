@ECHO OFF
setx NODE_PATH "dist-chat/src;dist-chat/examples/chat" > $null
@ECHO ON
node ./dist-chat/examples/chat/index.js