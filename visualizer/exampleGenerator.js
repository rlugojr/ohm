/* eslint-env browser */

'use strict';

postMessage('WOKER IMPORTING`');
self.importScripts('../dist/ohm.js', 'utils.js');
postMessage('WORKER IMPORTED');

// Web Worker that generates examples.
// communicates with 'exampleGenerationUI.js'

// TODO: prevent this from generating forever

(function(root, initModule) {
  if (typeof exports === 'object') {
    module.exports = initModule;
  } else {
    initModule(root.ohm, root.utils);
  }
})(this, function(ohm, utils) {
  postMessage('WORKER STARTED');
  var grammar;

  var examplePieces = {};

  var overrides = {
    ident: function(g, ex, syn, args) {
      return {needHelp: true};
    },
    letter: function(g, ex, syn, args) {
      if(Math.floor(Math.random() * 2) === 0){
        return {example: String.fromCharCode(Math.floor(26 * Math.random()) + 'a'.charCodeAt(0))};
      } else {
        return {example: String.fromCharCode(Math.floor(26 * Math.random()) + 'A'.charCodeAt(0))};
      }
    }
  };


  self.addEventListener('message', function(e) {
    switch(e.data.name){
      case 'initialize':
        // create grammar from recipe
        postMessage('INITIALIZED');
        grammar = ohm.makeRecipe(eval(e.data.recipe));
        start();
        break;
      case 'examplesFor':
        var examplesForRule = examplePieces[e.ruleName] || null;
        self.postMessage({name: 'examplesFor',
                          ruleName: e.ruleName,
                          examples: examplesForRule});
        break;
      case 'examplesNeeded':
        var examplesNeeded = utils.difference(
          Object.keys(grammar.ruleBodies),
          Object.keys(examplePieces)
        );

        self.postMessage({name: 'examplesNeeded',
                          examplesNeeded: examplesNeeded});
        break;
      case 'userExample':
        postMessage('RECEIVED USER EXAMPLE');
        processExampleFromUser(e.data.example, e.data.ruleName);
        break;
      case 'echo':
        self.postMessage(echo.message);
        break;
    }
    // schedule next task
  }, false);

  function processExampleFromUser(example, optRuleName) {
    if(optRuleName){
      var trace = grammar.trace(example, optRuleName);
      if(trace.succeeded){
        addPiecesToDict(trace, examplePieces);
      }
    }

    utils.objectForEach(grammar.ruleBodies, function(ruleName) {
      var trace = grammar.trace(example, ruleName);
      if(trace.succeeded){
        addPiecesToDict(trace, examplePieces);
      }
    });
  }

  function addPiecesToDict(trace, examples) {
    if(trace.expr.constructor.name === 'Terminal'){
      return;
    } else {
      if(trace.expr.constructor.name === 'Apply'){
        var ruleName = trace.expr.toString();
        if(!examples.hasOwnProperty(ruleName)){
          examples[ruleName] = [];
        }

        if(!examples[ruleName].includes(trace.interval.contents)){
          examples[ruleName].push(trace.interval.contents);
        }
      }
      trace.children
           .filter(function(child) { return child.succeeded; })
           .forEach(function(child) { return addPiecesToDict(child, examples); });
    }
  }

  /////////////////////////////////////////////////////////////////

  // task state

  function ExampleGenerator(examplePieces) {
    this.examplePieces = examplePieces;
    this.rules = initialRules(grammar);
    this.examplesNeeded = utils.difference(
      Object.keys(grammar.ruleBodies),
      Object.keys(examplePieces)
    );
    this.currentRuleIndex = 0;
  }

  ExampleGenerator.prototype.next = function() {
    var that = this;
    var currentRuleName = this.rules[this.currentRuleIndex];

    utils.repeat(2, function() {
      that.examplesNeeded =
        generateExampleForRule(that.rules,
                               currentRuleName,
                               that.examplesNeeded);
    });

    this.currentRuleIndex = (this.currentRuleIndex + 1) % this.rules.length;
  };

  function runComputationStep(generator, n) {
    n = n || 1;

    utils.repeat(n, function() {
      generator.next();
    });

    if(generator.examplesNeeded.length > 0){
      setTimeout(function() { runComputationStep(generator, n); }, 0);
    }
  }

  function start() {
    var generator = new ExampleGenerator(examplePieces);
    runComputationStep(generator, 500);
  }


  // HELPER FUNCTIONS
  /////////////////////

  function initialRules(grammar) {
    var rules = [];
    utils.objectForEach(grammar.ruleBodies, function(ruleName, ruleBody) {
      if(!parametrized(ruleName, grammar)){
        rules.push(ruleName);
      }
    });
    return rules;
  }

  function generateExampleForRule(rules, ruleName, examplesNeeded) {
    var rulePExpr = parseToPExpr(ruleName);

    var example;
    if(overrides.hasOwnProperty(ruleName)){
      example = overrides[ruleName](
        grammar, examplePieces, isSyntactic(rulePExpr.ruleName),
        rulePExpr.args
      );
    } else {
      example = grammar.ruleBodies[rulePExpr.ruleName].generateExample(
        grammar, examplePieces, isSyntactic(rulePExpr.ruleName),
        rulePExpr.args
      );
    }

    if(example.hasOwnProperty('example')
       && grammar.match(example.example, ruleName).succeeded()){
      if(examplesNeeded.includes(ruleName)){
        examplesNeeded = examplesNeeded.filter(function(rn) {
          return rn !== ruleName;
        });
        self.postMessage('generated '+ruleName+' '+JSON.stringify(examplesNeeded));
        self.postMessage({name: 'examplesNeeded',
                          examplesNeeded: examplesNeeded});
      }
      if(!examplePieces.hasOwnProperty(ruleName)){
        examplePieces[ruleName] = [];
      }
      if(!examplePieces[ruleName].includes(example.example)){
        examplePieces[ruleName].push(example.example);
      }
    }

    if(example.hasOwnProperty('examplesNeeded')) {
      example.examplesNeeded.forEach(function(needed) {
        if(!rules.includes(needed)){
          rules.push(needed);
        }
      });
    }

    return examplesNeeded;
  }


  function parametrized(ruleName, grammar) {
    return grammar.ruleFormals[ruleName].length > 0;
  }

  function parseToPExpr(ruleName) {
    return ohm._buildGrammar(ohm.ohmGrammar.match(ruleName, 'Base_application'));
  }

  function isSyntactic(ruleName) {
    return ruleName.charAt(0).toUpperCase() === ruleName.charAt(0);
  }

});
