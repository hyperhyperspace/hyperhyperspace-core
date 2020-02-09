
'use strict'

if (process.env.NODE_ENV === 'production') {
  module.exports = require('./hyper-hyper-space.cjs.production.min.js')
} else {
  module.exports = require('./hyper-hyper-space.cjs.development.js')
}
