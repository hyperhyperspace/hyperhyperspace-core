@ECHO OFF
setx NODE_PATH "dist-examples/src;dist-examples/examples/randomness-beacon" > $null
@ECHO ON
node ./dist-examples/examples/randomness-beacon/index.js