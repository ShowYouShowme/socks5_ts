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


enum Stage {
    AUTH,     // 认证
    CONNECT,  // 链接上游服务
    DELIVER   // 转发数据
}

// 测试方式
// ATYP == 0x01  curl --socks5 192.168.2.228:1080 http://www.baidu.com
// ATYP == 0x03  curl --socks5-hostname 192.168.2.228:1080 http://www.baidu.com

server.on('connection', socket => {
    let stage = Stage.AUTH;
    let ip: string = socket.remoteAddress as string;
    let family: string = socket.remoteFamily as string;
    let port: number = socket.remotePort as number;
    console.info(`新链接到来, ip = ${ip}, port = ${port}, family = ${family}`);
    let remoteHost : net.Socket;

    socket.on('data', (buffer: Buffer) => {
        logger.info(`RECV info from bs : ${buffer.toString()}`);
        switch (stage) {
            case Stage.AUTH: {
                // REQUEST
                //+-----+----------+----------+
                //| VER | NMETHODS | METHODS  |
                //+-----+----------+----------+
                //|  1  |    1     | 1 to 255 |
                //+-----+----------+----------+


                // REPLY
                //+-----+--------+
                //| VER | METHOD |
                //+-----+--------+
                //|  1  |   1    |
                //+-----+--------+
                let VER = buffer[0];
                let NMETHODS = buffer[1];
                let METHODS = buffer.subarray(2);
                logger.info(`VER = ${VER}, NMETHODS = ${NMETHODS}, METHODS = ${METHODS}`);
                let bf = new Buffer([0x05, 0x00]);
                socket.write(bf);
                stage = Stage.CONNECT;
                break;
            }
            case Stage.CONNECT: {
                // REQUEST
                //+-----+-----+-------+------+----------+----------+
                //| VER | CMD |  RSV  | ATYP | DST.ADDR | DST.PORT |
                //+-----+-----+-------+------+----------+----------+
                //|  1  |  1  | X'00' |  1   | Variable |    2     |
                //+-----+-----+-------+------+----------+----------+

                let VER = buffer[0];
                let CMD = buffer[1];
                let RSV = buffer[2];
                let ATYP= buffer[3];
                if(ATYP == 0x01){ // IPv4
                    let remoteIP : string = `${buffer[4]}.${buffer[5]}.${buffer[6]}.${buffer[7]}`;
                    let port     : number = buffer[8] * 255 +  buffer[9];
                    remoteHost = net.createConnection({
                        host : remoteIP,
                        port : port
                    });
                
                    remoteHost.on('connect', ()=>{
                        console.info(`connected to ${port}`);
                        // REPLY
                        //+-----+-----+-------+------+----------+----------+
                        //| VER | REP |  RSV  | ATYP | BND.ADDR | BND.PORT |
                        //+-----+-----+-------+------+----------+----------+
                        //|  1  |  1  | X'00' |  1   | Variable |    2     |
                        //+-----+-----+-------+------+----------+----------+
                        let VER = 0x05;
                        let REP = 0x00;
                        let RSV = 0x00;
                        let ATYP= 1;
                        let BND_ADDR = buffer.subarray(4,8);  // 不包含end
                        let BND_PORT = buffer.subarray(8);
                        let bf : Buffer = new Buffer([VER, REP, RSV, ATYP, ...BND_ADDR, ...BND_PORT]);
                        socket.write(bf);
                        stage = Stage.DELIVER;

                        remoteHost.on('data', (data: Buffer)=>{
                            socket.write(data);
                        });
                    });

                    remoteHost.on('error', (err: Error)=>{
                        logger.error(`远端出错, 关闭链接!`);
                        remoteHost.end();
                        socket.end();
                    });
                
                
                    remoteHost.on('close', (hadError: boolean)=>{
                        logger.error(`远端链接关闭!`);
                        // 链接关闭
                        remoteHost.end();
                        socket.end();
                    });
                } else if(ATYP == 0x03){ // 域名
                    let domainNameLen : number = buffer[4];
                    let domainName : string = buffer.subarray(5, domainNameLen).toString();
                } else if(ATYP == 0x04){ // IPv6
                    logger.error(`暂时不支持IPv6地址!`);
                    socket.end();
                } else{ // 非法的ATYPE
                    logger.error(`非法的ATYPE = ${ATYP}`);
                    socket.end();
                }
                break;
            }
            case Stage.DELIVER: {
                remoteHost.write(buffer);
                break;
            }
        }
    });

    socket.on('close', (hadError: boolean) => {
        logger.info(`客户端链接断开! hadError = ${hadError}`);
        if(remoteHost)
            remoteHost.end();
        socket.end();
    });
    socket.on('error', (err: Error) => {
        logger.error(`客户端链接异常! err = ${err}`);
        if(remoteHost)
            remoteHost.end();
        socket.end();
    });
})

server.on('close', () => {
    logger.error('Server Close!');
});

server.on('error', err => {
    logger.error(`socket error = ${err}, 进程结束!`);
    process.exit(-1);
});