var global = this

;(function() {

  var _ocCls = {};
  var _jsCls = {};

  var _formatOCToJS = function(obj) {
    if (obj === undefined || obj === null) return false
    if (typeof obj == "object") {
      if (obj.__obj) return obj
      if (obj.__isNil) return false
    }
    if (obj instanceof Array) {
      var ret = []
      obj.forEach(function(o) {
        ret.push(_formatOCToJS(o))
      })
      return ret
    }
    if (obj instanceof Function) {
        return function() {
            var args = Array.prototype.slice.call(arguments)
            var formatedArgs = _OC_formatJSToOC(args)
            for (var i = 0; i < args.length; i++) {
                if (args[i] === null || args[i] === undefined || args[i] === false) {
                formatedArgs.splice(i, 1, undefined)
            } else if (args[i] == nsnull) {
                formatedArgs.splice(i, 1, null)
            }
        }
        return _OC_formatOCToJS(obj.apply(obj, formatedArgs))
      }
    }
    if (obj instanceof Object) {
      var ret = {}
      for (var key in obj) {
        ret[key] = _formatOCToJS(obj[key])
      }
      return ret
    }
    return obj
  }
  
  // 调用 objC 的方法
  var _methodFunc = function(instance, clsName, methodName, args, isSuper, isPerformSelector) {
    var selectorName = methodName
    if (!isPerformSelector) {
      methodName = methodName.replace(/__/g, "-")
      selectorName = methodName.replace(/_/g, ":").replace(/-/g, "_")
      var marchArr = selectorName.match(/:/g)
      var numOfArgs = marchArr ? marchArr.length : 0
      if (args.length > numOfArgs) {
        selectorName += ":"
      }
    }
    var ret = instance ? _OC_callI(instance, selectorName, args, isSuper):
                         _OC_callC(clsName, selectorName, args)
    return _formatOCToJS(ret)
  }

  // 自定义的 JS 对象原型方法
  var _customMethods = {
  
  // 用于调用 OC 方法的元函数，例如 UIView.alloc() 就相当于 UIView.__c('alloc')();
    __c: function(methodName) {
      var slf = this

      if (slf instanceof Boolean) {
        return function() {
          return false
        }
      }
      if (slf[methodName]) {
        return slf[methodName].bind(slf);
      }

      if (!slf.__obj && !slf.__clsName) {
        throw new Error(slf + '.' + methodName + ' is undefined')
      }
  
     // 调用 self.super() 时，获取父类名，后面调用方法时，就会直接父类这个方法的实现进行调用
      if (slf.__isSuper && slf.__clsName) {
          slf.__clsName = _OC_superClsName(slf.__obj.__realClsName ? slf.__obj.__realClsName: slf.__clsName);
      }
  
     // A.如果是 JS 端定义的方法，就直接调用 JS 端定义的方法实现
      var clsName = slf.__clsName
      if (clsName && _ocCls[clsName]) {
        var methodType = slf.__obj ? 'instMethods': 'clsMethods'
        if (_ocCls[clsName][methodType][methodName]) {
          _OC_log('Call JS Method: ' + clsName + ',' + methodName);
          slf.__isSuper = 0;
          return _ocCls[clsName][methodType][methodName].bind(slf)
        }
      }

      // B. 返回一个调用 OC 的函数用于调用 OC 中定义的方法
       _OC_log('Call OC Method: ' + clsName + ',' + methodName);
      return function(){
        var args = Array.prototype.slice.call(arguments)
        return _methodFunc(slf.__obj, slf.__clsName, methodName, args, slf.__isSuper)
      }
    },

    // super() 的实现
    super: function() {
      var slf = this
      if (slf.__obj) {
        slf.__obj.__realClsName = slf.__realClsName;
      }
      // 返回一个新的对象，这个对象同样保存了 OC 对象的引用，同时标识 __isSuper = 1
      return {__obj: slf.__obj, __clsName: slf.__clsName, __isSuper: 1}
    },

    performSelectorInOC: function() {
      var slf = this
      var args = Array.prototype.slice.call(arguments)
      return {__isPerformInOC:1, obj:slf.__obj, clsName:slf.__clsName, sel: args[0], args: args[1], cb: args[2]}
    },

    performSelector: function() {
      var slf = this
      var args = Array.prototype.slice.call(arguments)
      return _methodFunc(slf.__obj, slf.__clsName, args[0], args.splice(1), slf.__isSuper, true)
    }
  }

  // 给 Object 的原型对象添加方法，这样就可以让所有具有典型原型链继承的 JS 对象都拥有这些方法，用于调用 OC
  for (var method in _customMethods) {
    if (_customMethods.hasOwnProperty(method)) {
      Object.defineProperty(Object.prototype, method, {value: _customMethods[method], configurable:false, enumerable: false})
    }
  }

  // 内部调用的 require 函数，每个 OC 类的信息都保存在JS全局作用域上的同名变量中
  var _require = function(clsName) {
    if (!global[clsName]) {
      global[clsName] = {
        __clsName: clsName
      }
    } 
    return global[clsName]
  }

  // 全局的 require 函数，返回的是一个 JS 对象
  global.require = function() {
    var lastRequire
    for (var i = 0; i < arguments.length; i ++) {
      arguments[i].split(',').forEach(function(clsName) {
        lastRequire = _require(clsName.trim())
      })
    }
    return lastRequire
  }

  // 对 JS 中的方法进行封装 methods  --> newMethods
  // 这里做了两件事情：一是计算函数参数个数，二是实现 self 关键字
  var _formatDefineMethods = function(methods, newMethods, realClsName) {
    for (var methodName in methods) {
      if (!(methods[methodName] instanceof Function)) return;
      (function(){
        var originMethod = methods[methodName]
       // 将方法相关信息以数组的形式保存起来，第一个元素为函数参数个数，第二个元素是函数本身
        newMethods[methodName] = [originMethod.length, function() {
                                  // 所有的方法调用都会转到这里来
          try {
            var args = _formatOCToJS(Array.prototype.slice.call(arguments))
            var lastSelf = global.self
            global.self = args[0] // 给全局的 self 赋值，实现 self 关键字
            if (global.self) global.self.__realClsName = realClsName
            args.splice(0,1)
            var ret = originMethod.apply(originMethod, args)
            global.self = lastSelf
            return ret
          } catch(e) {
            _OC_catch(e.message, e.stack)
          }
        }]
      })()
    }
  }

  var _wrapLocalMethod = function(methodName, func, realClsName) {
    return function() {
      var lastSelf = global.self
      global.self = this
      this.__realClsName = realClsName
      var ret = func.apply(this, arguments)
      global.self = lastSelf
      return ret
    }
  }

  // 将 JS 中定义的示例方法和类方法保存到全局变量 _ocCls 中
  var _setupJSMethod = function(className, methods, isInst, realClsName) {
    for (var name in methods) {
      var key = isInst ? 'instMethods': 'clsMethods',
          func = methods[name]
      _ocCls[className][key][name] = _wrapLocalMethod(name, func, realClsName)
    }
  }

  var _propertiesGetFun = function(name){
    return function(){
      var slf = this;
      if (!slf.__ocProps) {
        var props = _OC_getCustomProps(slf.__obj)
        if (!props) {
          props = {}
          _OC_setCustomProps(slf.__obj, props)
        }
        slf.__ocProps = props;
      }
      return slf.__ocProps[name];
    };
  }

  var _propertiesSetFun = function(name){
    return function(jval){
      var slf = this;
      if (!slf.__ocProps) {
        var props = _OC_getCustomProps(slf.__obj)
        if (!props) {
          props = {}
          _OC_setCustomProps(slf.__obj, props)
        }
        slf.__ocProps = props;
      }
      slf.__ocProps[name] = jval;
    };
  }

  // 用于定义一个类的全局函数
  global.defineClass = function(declaration, properties, instMethods, clsMethods) {
    var newInstMethods = {}, newClsMethods = {}
    if (!(properties instanceof Array)) { // 考虑到没有定义 properties 的情况，譬如 function(declaration, instMethods, clsMethods)
      clsMethods = instMethods
      instMethods = properties
      properties = null
    }

    // 创建属性的 get 和 set 方法，保存到 instMethods 中
    if (properties) {
      properties.forEach(function(name){
        if (!instMethods[name]) {
          instMethods[name] = _propertiesGetFun(name);
        }
        var nameOfSet = "set"+ name.substr(0,1).toUpperCase() + name.substr(1);
        if (!instMethods[nameOfSet]) {
          instMethods[nameOfSet] = _propertiesSetFun(name);
        }
      });
    }

   // 拿到类名
    var realClsName = declaration.split(':')[0].trim()

    _formatDefineMethods(instMethods, newInstMethods, realClsName)
    _formatDefineMethods(clsMethods, newClsMethods, realClsName)

   // 调用 OC 中实现的 _OC_defineClass 函数进行 OC 端类的定义
    var ret = _OC_defineClass(declaration, newInstMethods, newClsMethods)
    var className = ret['cls']
    var superCls = ret['superCls']

    _ocCls[className] = {
      instMethods: {},
      clsMethods: {},
    }

    // 将 _ocCls 中父类中的方法复制到子类中来（这里是指 JS 中定义的方法）
    if (superCls.length && _ocCls[superCls]) {
      for (var funcName in _ocCls[superCls]['instMethods']) {
        _ocCls[className]['instMethods'][funcName] = _ocCls[superCls]['instMethods'][funcName]
      }
      for (var funcName in _ocCls[superCls]['clsMethods']) {
        _ocCls[className]['clsMethods'][funcName] = _ocCls[superCls]['clsMethods'][funcName]
      }
    }

    // 将示例方法和类方法保存到全局变量 _ocCls 中（这里是指 JS 中定义的方法）
    _setupJSMethod(className, instMethods, 1, realClsName)
    _setupJSMethod(className, clsMethods, 0, realClsName)

    return require(className)
  }

  // 定义协议
  global.defineProtocol = function(declaration, instProtos , clsProtos) {
      var ret = _OC_defineProtocol(declaration, instProtos,clsProtos);
      return ret
  }

  // 封装 block 的函数
  global.block = function(args, cb) {
    var that = this
    var slf = global.self
    if (args instanceof Function) {
      cb = args
      args = ''
    }
    var callback = function() {
      var args = Array.prototype.slice.call(arguments)
      global.self = slf
      return cb.apply(that, _formatOCToJS(args))
    }
    var ret = {args: args, cb: callback, argCount: cb.length, __isBlock: 1}
    if (global.__genBlock) {
      ret['blockObj'] = global.__genBlock(args, cb)
    }
    return ret
  }
  
  if (global.console) {
    var jsLogger = console.log;
    global.console.log = function() {
      global._OC_log.apply(global, arguments);
      if (jsLogger) {
        jsLogger.apply(global.console, arguments);
      }
    }
  } else {
    global.console = {
      log: global._OC_log
    }
  }

  global.defineJSClass = function(declaration, instMethods, clsMethods) {
    var o = function() {},
        a = declaration.split(':'),
        clsName = a[0].trim(),
        superClsName = a[1] ? a[1].trim() : null
    o.prototype = {
      init: function() {
        if (this.super()) this.super().init()
        return this;
      },
      super: function() {
        return superClsName ? _jsCls[superClsName].prototype : null
      }
    }
    var cls = {
      alloc: function() {
        return new o;
      }
    }
    for (var methodName in instMethods) {
      o.prototype[methodName] = instMethods[methodName];
    }
    for (var methodName in clsMethods) {
      cls[methodName] = clsMethods[methodName];
    }
    global[clsName] = cls
    _jsCls[clsName] = o
  }
  
  global.YES = 1
  global.NO = 0
  global.nsnull = _OC_null
  global._formatOCToJS = _formatOCToJS
  
})()
