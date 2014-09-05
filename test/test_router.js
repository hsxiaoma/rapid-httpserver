/**
 * New node file
 */

// ====================================================== //
// ============        UNIT TEST         ================ //
// ====================================================== //

GLOBAL.log = require("rapid-log")();
var $,Router;
var ActionVisitor  = require("../libs/actionVisitor.js");

$ = Router = require("../libs/router.js");

$.defineExtension("ext1", function(req,res){
    return {exec:function(str){
        //log.info("i'm ext1");
        return "i'm ext1, " + str;
    }}
});

$.defineExtension("ext2", function(req,res){
    return {exec:function(str){
        //log.info("i'm ext2");
        return "i'm ext2, " + str;
    }}
});

$.defineAction("action1",["ext1","ext2"],function(ext1,ext2){
    
    var content = '<img id="abc" />';
    
    var str = ext2.exec(ext1.exec("ok" + content));
    str += '<script type="text/javascript">'
        + 'console.log("trying"); \n'
        + 'setTimeout(function(){'
        + 'var img = document.querySelector("img"); \n'
        + 'img.src = "http://img3.3lian.com/2006/013/08/20051103121420947.gif" \n'
        + 'console.log("end");\n'
        + '},1000);'
        + '</script>'
        
    //log.info("i'm action1");
    this.send(str);
});

$.defineFilter("filt1",function(){
    //log.info("i'm filt1");
    this.next();
});

$.defineFilter("filt2",function(){
    //log.info("i'm filt2");
    if(~~(Math.random() * 10) > 9){
        this.finish(new Error("this is end!"));
    }else{
        this.next();
    }
});

var root = new $({
    defaultAction:function(){
        this.send("lalalalalalala.....");
    }
});



//debugger;
var abc = new $({
    filters:[
//         {
//            url:"/def/*",
//            doFilter:"filtx"
//         },
        {
           url:"/*",
           doFilter:"filt1"
       }],
    defaultAction:"action1"
});

var def = new $({
    filters:[
         {
             url:"/*",
             doFilter:"filt2"
         }
    ],
    defaultAction:function(){
       this.send("hahahahahahahaha.....");
    }
});

root.mount("/abc",abc);

abc.mount("/def",def);

console.log("before start");

var cluster = require('cluster');
var http = require('http');

if (cluster.isMaster) {

  // Keep track of http requests
  var numReqs = 0;
  setInterval(function() {
    console.log("numReqs =", numReqs);
  }, 1000);

  // Count requestes
  function messageHandler(msg) {
    if (msg.cmd && msg.cmd == 'notifyRequest') {
      numReqs += 1;
    }
  }

  // Start workers and listen for messages containing notifyRequest
  var numCPUs = require('os').cpus().length;
  for (var i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  Object.keys(cluster.workers).forEach(function(id) {
    cluster.workers[id].on('message', messageHandler);
  });

} else {

  // Worker processes have a http server.
  http.Server(function(req, res) {
      
      var context = new ActionVisitor(req,res);
      
      context.on("error",function(err){
          console.err(err.stack);
          this.sendError(err,500);
      })
      
      root.dispatch(context,{
          parentMatch:"/",
          matchPerfix:"/",
          rest:context.req_pathname
      });
//      res.end("hello");
    // notify master about the request
    process.send({ cmd: 'notifyRequest' });
  }).listen(8000,function(){
      log.info("%s http server start runing, on port %d...", "UnitTest For Router", 8088);
  });
}


//var server = http.createServer(function(req, res){
//  
//});
//
//server.listen(8088,function(){
   
//});
//
//var url = [
//    "/abc/1def/ghi/jkl?a=100&b=200",
//    "/abc/1def/ghi/jkl?a=100&b=200"
//   ];
//
//
//var c = 0
//for (var i=0;i<=10000;i++){
//    
//    var fakeReq = _extend(new EventEmitter(),{
//        url:url[ ~~(Math.random() * 2) ]
//    });
//    
//    var fakeRes = _extend(new EventEmitter(),{
//        send:function(str){
//            log.info(c + ";   " + str);
//            if(++c >= 10000){
//                console.timeEnd("t");
//                console.log("=======\n=======\n =======\n =======\n ======= end  =======\n =======\n =======\n =======\n ");
//            }
//        }
//    });
//    
//    var fakeContext = _extend(new ActionVisitor(fakeReq,fakeRes),{
//        send:function(str){
//            this.response.send(str);
//        }
//    });
//    
//    var mydomain = Domain.create();
//    mydomain.add(fakeContext);
//    
//    mydomain.on("error",function(err){
//        fakeContext.send(err.stack);
//    });
//    
//    var fakePathInfo = {
//            parentMatch:"/",
//            matchPerfix:"/"
//    };
//    
//    fakePathInfo.rest = fakeContext.req_pathname = getReqPath(fakeReq.url);
//    
////log.info(path.join(fakePathInfo.parentMath,fakePathInfo.rest));
//    debugger;
//    root.dispatch(fakeContext,fakePathInfo);
//}

//log.info("ok");