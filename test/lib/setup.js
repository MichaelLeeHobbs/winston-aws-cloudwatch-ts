/* eslint-disable */
// @ts-nocheck FIXME: once we are ready to convert to TypeScript, remove this

const chai = require('chai')
const chaiAsPromised = require('chai-as-promised')
const sinonChai = require('sinon-chai')
const sinon = require('sinon')

// Ensure ts-node compiles TS to CommonJS for mocha (which runs in CJS)
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
  esModuleInterop: true,
  allowJs: true
})
require('ts-node/register/transpile-only')

chai.use(chaiAsPromised)
chai.use(sinonChai)

global.expect = chai.expect
global.sinon = sinon
