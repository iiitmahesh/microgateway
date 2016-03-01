'use strict';

let _ = require('lodash');
let assert = require('assert');
let fs = require('fs');
let path = require('path');
let echo = require('./support/echo-server');
let supertest = require('supertest');
let microgw = require('../lib/microgw');
let apimServer = require('./support/mock-apim-server/apim-server');

describe('data-store', function() {
  let request;
  let snapshotID;
  before((done) => {
    process.env.DATASTORE_PORT = 5000;
    process.env.APIMANAGER_PORT = 8081;
    process.env.APIMANAGER = '127.0.0.1';
    process.env.NODE_ENV = 'production';
    echo.start(8889)
      .then(() => apimServer.start('127.0.0.1', 8081))
      .then(() => microgw.start(3000))
      .then(() => {
        request = supertest('http://localhost:5000');
      })
      .then(done)
      .catch((err) => {
        console.error(err);
        done(err);
      });
  });

  after((done) => {
    delete process.env.DATASTORE_PORT;
    delete process.env.APIMANAGER_PORT;
    delete process.env.APIMANAGER;
    delete process.env.NODE_ENV;
    microgw.stop()
      .then(() => echo.stop())
      .then(() => apimServer.stop())
      .then(done, done)
      .catch(done);
  });

  function verifyResponseArray(res, expected) {
    assert.strictEqual(res.length, expected.length);

    for(var i = 0; i < expected.length; i++) {
      var expect = expected[i];
      var actual = res[i];
      for (var prop in expect) {
        if (expect.hasOwnProperty(prop)) {
          assert.strictEqual(actual[prop], expect[prop]);
        }
      }
    }
  }

  function verifyResponseSingle(res, expected) {
    for (var prop in expected) {
      if (expected.hasOwnProperty(prop)) {
         assert.strictEqual(res[prop], expected[prop]);
      }
    }
  }

  it('snapshots should have single current entry with ref count of 1',
    function(done) {
      var expect = [{refcount : '1', current: true}];
      request
        .get('/api/snapshots')
        .expect(function(res) {
            verifyResponseArray(res.body, expect);
            snapshotID = res.body[0].id;
            assert(snapshotID.length === 5); // ID's are strings of 5 characters
            assert(parseInt(snapshotID) >= 0); // ID's are >= 0
            assert(parseInt(snapshotID) < 65536); // ID's are < 65536
          }
        ).end(done);
    }
  );
  it('current should return current snapshot and increment ref count',
    function(done) {
      var expect = {refcount : '2', current: true};
      request
        .get('/api/snapshots/current')
        .expect(function(res) {
            verifyResponseSingle(res.body.snapshot, expect);
            assert(res.body.snapshot.id === snapshotID); // ID should be same as previous
          }
        ).end(done);
    }
  );
  it('release should return current snapshot and decrement ref count',
    function(done) {
      var expect = {refcount : '1', current: true};
      request
        .get('/api/snapshots/release?id=' + snapshotID)
        .expect(function(res) {
            verifyResponseSingle(res.body.snapshot, expect);
            assert(res.body.snapshot.id === snapshotID); // ID should be same as previous
          }
        ).end(done);
    }
  );
  it('release should remove current snapshot and decrement ref count and cleanup dir',
    function(done) {
      var expect = {snapshot : {}};
      request
        .get('/api/snapshots/release?id=' + snapshotID)
        .expect(function(res) {
            assert(_.isEqual(expect, res.body));
            
          }
        ).end(function (err, res) {
            if (err) return done(err);
            setTimeout(
              function () {
                // check for non existence of directory
                try {
                  var stats = fs.statSync(process.env['ROOTCONFIGDIR'] + snapshotID);
                } catch (e) {
                  if(e.code === 'ENOENT') return done(); // expected
                }
                done(new Error('Snapshot directory still exists'));
              },
              1500 // 1.5 seconds to cleanup
            );
          }
        );
    }
  );

});
