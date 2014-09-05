/**
 * Mapping to the Router;
 * 
 * @author wangsu01@baidu.com
 * @file router.js
 */

var format = require("util").format;
var inherits = require("util").inherits;
var _extend = require("util")._extend;
var EventEmitter = require("events").EventEmitter;
var Domain = require("domain");
var path = require('path');

var urlParse = require('url').parse;
var querystring = require('querystring');

var depcle = require("./lib.js").depcle;
var getFunArgs = require("./lib.js").getFunArgs;
var wildcardToReg = require("./lib.js").wildcardToReg
var randomStr = require("./lib.js").randomStr;

var Chain = require("./chain.js");

var tplEngine = require("./views");

var isArray = Array.isArray;

var actions = {}, filters = {}, extensions = {};

/**
 * 包装action与filter的原始方法,使所有可执行的内容具有统一的调用接口
 */
var packingShell = function(depends,handle){
    /**
     * 对action和filter的调用,将被包装为以下这种接口样式. 区别仅在于this上方法的传递,
     * filter上会有next方法,而action做为执行链的结束将没有这个方法.
     * 
     * @param req {IncomingMessage} httpserver中request事件的request对像.
     * @param res {ServerResponse} httpserver中的request事件的response对像.
     * @param cachedExt {Map} 在过滤链上时,已创建过的extension将被缓存到这个
     *      对像上,防止多次创建相同extension的运行开销及携带数据丢失.
     */
    return function(){
        var args = [];
        var lostExtensions = [];
        var me = this;
        var req = me.request,
            res = me.response,
            cachedExt = me.cachedExt;
        /*
         * 这里需要将extensions中缺少depends中所需的项目视为Unhandle,
         */
        var unhandlMsg = false;
        if(depends.every(function(name){
            var value;
            
            // 优先从缓存中取值
            if(value = cachedExt[name]){
                args.push(value);
                return true;
            }else{
                value = extensions[name];
                /**
                 * extension 不执行业务逻辑,所以不传入this对像, 这种设计主要为了保证extension只能使用req与res两个标准对像
                 */
                return value ? (args.push(cachedExt[name] = value.call({},req,res)),true) : (lostExtensions.push(name),false);
            }
        })){
            // depends 完整, 执行handle
            handle.apply(me, args);
            //return by process ok!  any exception will be throw;
            return; 
        }else{
            // 缺少必要的extension.异常
            unhandlMsg = format("Unhandle Exception : missing extension [%s] , ignore the request." , lostExtensions.join(","));
        }
        
        // 这里抛出错误,是为了扔给superAction统一处理; 为方便增加Error_handle
        throw new Error(unhandlMsg);
        
    }
};

var buildFilterHandle = function(item){
    
    // 如果未指定url,则认为匹配全部
    var url = wildcardToReg(item.url || /(.*)/);
    var exec , name = item.doFilter, params = item.params || {};
    
     switch(typeof(name)){
        case "function":
            exec =  packingShell([],name);
            break;
        case "string":
            exec = filters[name];
            if(!exec){
                exec = name;
                log.info("waiting filter [%s], try again at request event", filterName);
            }
            break;
        default:
            throw new Error("type error: doFilter is not function or string! [" + typeof(filter) + "]");
    }
    
    return {
        url:url,
        exec:exec,
        params : params
    };
}


var buildActionHandle = function(item){
    
    var url = wildcardToReg(item.url || /(.*)/);
    // 保证一定是一个可处理的handle对像
    var handle, value = null , params = item.params || {};
    
    /**
     * 按优先级判断handle，
     * 因为在配置文件中可以乱写，有可能一口气写好几个，
     * 所以这里由高至低定义优先级为：doAction -> http_status -> resource -> redirect
     * 发现任意一个，即忽略其它。
     * 所有的实现，最终全都是doAction实现,
     * http_status和redirect只是预定义的快捷方式
     */
    if(value = item.doAction){
        //debugger;
        switch(typeof(value)){
            case "function":
                handle =  packingShell([],value);
                break;
            case "string":
                handle = actions[value];
                if(!handle){
                    handle = value; 
                    log.info("waiting actions [%s], try again at request event", value);
                }
                break;
            default:
                throw new Error("type error: doAction is not function or string! [" + typeof(filter) + "]");
        }
    }else if(value = item.http_status){
        handle = actions['http_status'];
        // 附加参数
        params.code = value.code;
        params.msg = value.msg;
        params.body = value.body;
    }else if(value = item.resource){
        handle = actions['resource'];
        params.dst_path = value;
    }else if(value = item.redirect){
        handle = actions['redirect'];
        params.url = value;
    }
    
    
    return {
        url : url,
        exec : handle,
        params : params
    };
};


var Router = function(opts){
    this.subs = [];
    this.filters = [];
    this.actions = [];
    
    if(!(opts && (opts.map || opts.filters || opts.defaultAction))){
        throw new Error("Invalid argument, opts don't have any executable item , need one of 'mapping','filter','defaultAction'");
    }
    
    if(isArray(opts.filters)){
        opts.filters.forEach(function(conf){
            this.filters.push(buildFilterHandle(conf));
        },this);
    }
    
    if(isArray(opts.mapping)){
        opts.mapping.forEach(function(conf){
            this.actions.push(buildActionHandle(conf));
        },this);
    }
    
    if(typeof(opts.defaultAction) == "string"){
        this.defaultAction = actions[opts.defaultAction];
        if(!this.defaultAction){
            this.defaultAction = (function(actionName,me){
                return function(){
                    me.defaultAction = actions[actionName];
                    if( !me.defaultAction ){
                        me.defaultAction.apply(this,arguments);
                    }else{
                        throw new Error("Action ["+actionName+"] is not exists!");
                    }
                }
            })(actionName,me);
        }
    }else{
        this.defaultAction = opts.defaultAction || false;
    }
    
    if(typeof(opts.error) == "string"){
        this.error = actions [opts.error];
        
        if(!this.error){
            this.error = (function(actionName,me){
                return function(){
                    me.error = actions[actionName];
                    if( !me.error ){
                        me.error.apply(this,arguments);
                    }else{
                        throw new Error("error handle [" + actionName + "] is not exists!");
                    }
                }
            })(actionName,me);
        };
    }else{
        this.error = opts.error || false;
    }
};

Router.prototype = {
    __findActionByName:function(name){
        return actions[name];
    },
    /**
     * 折分url中的path部份.同时 
     * 
     * @param pathname
     * @param parents_perfix
     * @returns
     */
    __splitPath:function(pathname, parents_perfix){
        parents_perfix = parents_perfix || "/";
        
        /**
         * 处理前缀.
         * 每个前缀认为是一级路径,即以 / 结尾,
         *  传入的parents_perfix是每一级父节点中已匹配的前缀拼接后的前缀路径
         */
        if(! this.endWith.test(parents_perfix)){
            parents_perfix += "/";
        }
        
        if(restPath.indexOf(parents_perfix) == 0){
            restPath = restPath.substr(parents_perfix.length - 1);
            
            if(restPath.indexOf(this._perfix) == 0){
                return {
                    restPath : restPath,
                    matchPath : path.join(parents_perfix,this._perfix,"/"),
                };
            }
        }
        
        return false;
    },
    /*
     * 错误派发.
     * 先尝试派发到当前router,如果没有error处理的action,则派发到上一级,一直到root为止,保证错误被处理.
     */
    dispatchError:function(err,context){
        if(this.error){
            this.error.call(context,err);
        }else{
            this.parent.dispatchError(err,context);
        }
    },
    // 派发请求
    dispatch : function(context,pathInfo,isReverse){
        //debugger;
        var me = this;
        var req = context.request;
        var res = context.response;
        var domain = context.domain;
        var execFilter = [];
        
        var restPart = path.join("/", pathInfo.rest);
        var parentMath =  path.join(pathInfo.parentMatch,"/");
        
        context.currentRouter = me;
        
        /*
         * 向子router派发请求.如果与子router中的perfix前缀匹配,,
         * 则交给子router处理,直接子router处理不了,
         * 回派给parent时才回到上级的action链上继续处理,这种情况下
         * 除非配置了match url的action,否则一般直接进入defaultAction.
         */
        var sub_dispatch = domain.bind(function(sub){
            var perfix = sub.perfix;
            var sub = sub.router;
            
            var subPathInfo = {};
            
            var subRestPath = null;
            
            if(restPart.indexOf(perfix) == 0){
                
                subPathInfo.parentMatch = path.join(parentMath,perfix,"/");
                subPathInfo.rest = restPart.substr(perfix.length - 1);
                subPathInfo.matchPerfix = perfix;
                
                setImmediate(function(subRouter,context,subPathInfo){
                    log.dev("dispathc : %s", subPathInfo.rest);
                    subRouter.dispatch(context,subPathInfo);
                }, sub,context,subPathInfo);
                
                return true;
            }
            return false;
        });
        
        var filters_dispatch = function(fitem,index,fullArr){
            var rv = true;
            var url = fitem.url;
            var execname, exec;
            
            exec = execname = fitem.exec;
            
            if(url.test(restPart)){
                
                if(!(exec instanceof Function)){
                    /*
                     * 已经是可执行的filter对像. 直接压进执行链
                     * 如果不是可执行对像,则应为一个字符串名称, 
                     * 尝试从filters的map中找.
                     *  找到则继续,
                     *  找不到则压入一个抛出错误替代执行元素
                     */
                    
                    if(! ((exec = filters[execname]) instanceof Function)){
                        exec = new Error("filter[" + execname + "] is not define!");
                        // 清空之前的所有执行内容,直接在执行请抛出异常.
                        execFilter.length = 0;
                        rv = false;
                    }
                }
                
                /**
                 * 根据rv的值来决定是否执行filter.
                 * 如果为true, 则证明,filterItem能正常执行,这种情况下,创建执行闭包并压入执行链
                 * 如果为false,则证明未找到filterItem所指向的filter,
                 *  这种情况下,应该直接终止执行链的后续动作,并将需抛出的异常压入执行链中
                 */
                execFilter.push(rv ? (function(exec,urlPattern,params){
                    return function(context,next){
                        //debugger;
                        context.next = next;
                        context.finish = function(err){
                            next(err,true);
                        };
                        context.urlPattern = urlPattern;
                        context.params  = depcle(params);
                        exec.call(context);
                    };
                })(exec,fitem.url,fitem.params) : exec);
                
            }
            
            return rv;
        };
        
        var actions_dispatch = domain.bind(function(aitem,index,fullArr){
            var rv = true;
            var url = aitem.url;
            var execname, exec;
            exec = execname = aitem.exec;
            
            if(url.test(restPart)){
                
                if(!(exec instanceof Function)){
                    /*
                     * 已经是可执行的filter对像. 直接压进执行链
                     * 如果不是可执行对像,则应为一个字符串名称, 
                     * 尝试从filters的map中找.
                     *  找到则继续,
                     *  找不到则压入一个抛出错误替代执行元素
                     */
                    
                    if(!((exec = actions[execname]) instanceof Function)){
                        throw new Error("action[" + execname + "] is not define!");
                    }
                    
                    // 下次直来不需再进行字符串取值
                    aitem.exec = exec;
                }
                
                this.urlPattern = url;
                this.params = depcle(aitem.params);
                
                exec.call(this);
                return true
            }
            
            return false;
        });
        
        var reverseToParent = function(){
            me.parent.dispatch(context,pathInfo,true);
        };
        
        // 派发actions及defaultAction;
        var runActions = function(){
            //debugger;
            if(me.actions.some(actions_dispatch,context)){
                // 被当前action中的某个处理.不再继续
                return;
            }
            
            /*
             * 派发至defaultAction, 
             * 如果没有default,则派发至parent的defaultAction.
             * 此操作用来保证请求一定被处理;
             */ 
            if(me.defaultAction){
                me.defaultAction.call(context,me.defaultAction);
            }else{
                reverseToParent();
            }
        };
        
        
        // 如果是从sub向上抛出的派发请求, 则跳过filter与sub直接走action.
        if(isReverse){
            /**
             * 反着拼一下url和path部份.
             */
            return runActions();
        }
        
        /**
         * 派发过程为 filter -> sub_router ->  action;
         * 
         * filter除异常外其它情况需保证完全通过整条执行链
         * sub_routers中内容被处理,则不再继续后面的action链;
         * action遇到处理即停止. 
         * 如果action没有处理成功,则常试defaultAction,
         * 如果当前router没有defaultAction,则抛给parent继续派发.
         * 
         */
        // forEach只是找取match这次请求的filter,但是并未执行
        var dofilter = me.filters.every(filters_dispatch);
        
        /*
         * 如果dofilter为false的情况下,表示filters中存在不能
         * 找到执行内容的filter. 所以直接执行execfilter中的第
         * 一个即可返回错误.不需要构建执行链.
         */
        if(dofilter){
            
            // filter中存在异步处理,所以依赖执行链.
            var fc = new Chain(execFilter,true);
            
            // fc不处理错误,出果出现不可控异常直接抛给context的domain;
            domain.add(fc);
            
            // fc 结束后,才执行后续派发;
            fc.next(context).whenFinish(function(err){
                //debugger;
                delete context.next;
                delete context.finish;
                
                if(err){
                    // 错误直接抛出给content.
                    domain.emit("error",err);
                    return;
                }
                
                // 派发sub_router, subs为同步判断, 所以直接使用数组的some方法
                if(me.subs.some(sub_dispatch,context)){
                    // 如果subs能构处理,则直接交给subs,并且不再继续.
                    return true;
                }
                
                runActions();
                
                fc.destroy();
            });
            
        }else{
            
            //直接响应错误;
            domain.emit("error",execFilter[0]);
        }
    },
    // 挂载子router
    mount : function(perfix,sub){
        
        if(! typeof(perfix) == "string"){
            throw new Error("perfix must be a string");
        }
        
        if(! sub instanceof Router){
            throw new Error("sub must be a instance of Router");
        }
        
        sub.parent = this;
        
        var item = {
            perfix:path.join(perfix,"/"),   // 只配置整级路径,即最后一个字符必须是 / ;
            router:sub
        };
        
        this.subs.push(item);
    }
};

Router.defineAction = function(name, depends, handle){
    
    if(typeof(name) != "string"){
        throw new Error("Invalid argument, name is not a string!");
        return;
    }
    
    if(actions[name]){
        log.info("httpd:redefined the action [%s]" , name);
    }else{
        log.info("httpd:defined action [%s]" , name);
    }
    
    if(!handle){
        handle = depends;
        depends = [];
    }
    
    // depends 检测. 如果未指定, 则扫描handle的参数列表
    if(!isArray(depends) || !depends.length > 0){
        depends = [];
        /**
         * handle有可能无参数. 
         */
        if(handle.length > 0){
            var params = getFunArgs(handle);
            if(params.length == handle.length){
                depends = params;
            }
        }
    }
    
    actions[name] = packingShell(depends,handle,extensions);
};

Router.defineFilter = function(name, depends, handle){
    if(typeof(name) != "string"){
        throw new Error("Invalid argument, name is not a string!");
        return;
    }
    
    if(filters[name]){
        log.info("httpd:redefined the filter [%s]" , name);
    }else{
        log.info("httpd:defined filter [%s]" , name);
    }
    
    if(!handle){
        handle = depends;
        depends = [];
    }
    
    // depends 检测. 如果未指定, 则扫描handle的参数列表
    if(!isArray(depends) || !depends.length > 0){
        depends = [];
        /**
         * handle有可能无参数.
         * filter可以没有任何参数..直接调用也行.因为的确有可能什么都不做.
         */
        if(handle.length > 0){
            var params = getFunArgs(handle);
            if(params.length == handle.length){
                depends = params;
            }
        }
    }
    filters[name] = packingShell(depends,handle,extensions);
};

Router.defineExtension = function(name, handle){
    
    if(typeof(name) != "string"){
        throw new Error("Invalid argument, name is not a string!");
        return;
    }
    
    if(extensions[name]){
        log.info("httpd:redefined the Extension [%s]" , name);
    }else{
        log.info("httpd:defined Extension [%s]" , name);
    }
    
    extensions[name] = handle;
};

module.exports = Router;