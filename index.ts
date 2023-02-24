import net from 'net';
import log4js from "log4js";

const logger = log4js.getLogger();
logger.level = "debug";

const HOST = '0.0.0.0';
const PORT = 1080;
// 使用nodejs实现的TCP服务
// 创建一个 TCP 服务实例
const server = net.createServer();

// 监听端口
server.listen(PORT, HOST);

server.on('listening', () => {
    logger.info(`服务已开启在 ${HOST}:${PORT}`);
});

server.on('connection', socket => {
    let ip     : string = socket.remoteAddress as string;
    let family : string = socket.remoteFamily as string;
    let port   : number = socket.remotePort as number; 
    console.info(`新链接到来, ip = ${ip}, port = ${port}, family = ${family}`);

    socket.on('data', buffer => {
        logger.info(`RECV info from bs : ${buffer.toString()}`);
    });

    socket.on('close', (hadError: boolean) => {
        logger.info(`客户端链接断开! hadError = ${hadError}`);
    });
    socket.on('error', (err: Error) => {
        logger.error(`客户端链接异常! err = ${err}`);
    });
})

server.on('close', () => {
    logger.error('Server Close!');
});

server.on('error', err => {
    logger.error(`socket error = ${err}, 进程结束!`);
    process.exit(-1);
});