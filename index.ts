import net from 'net';
import log4js from "log4js";

const logger = log4js.getLogger();
logger.level = "debug";
const HOST = '0.0.0.0';
const PORT = 1080;
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
    // console.info(`新链接到来, ip = ${ip}, port = ${port}, family = ${family}`);
    let remoteHost: net.Socket;


    // address 可以是 IPv4, 也可以是域名
    function onConnect(address: string, port: number) {
        remoteHost = net.createConnection({
            host: address,
            port: port
        });

        remoteHost.on('connect', () => {
            // REPLY
            //+-----+-----+-------+------+----------+----------+
            //| VER | REP |  RSV  | ATYP | BND.ADDR | BND.PORT |
            //+-----+-----+-------+------+----------+----------+
            //|  1  |  1  | X'00' |  1   | Variable |    2     |
            //+-----+-----+-------+------+----------+----------+
            let VER = 0x05;
            let REP = 0x00;
            let RSV = 0x00;
            let ATYP = 1;
            let BND_ADDR = Buffer.from([0x00, 0x00, 0x00, 0x00]);  // 不包含end
            let BND_PORT = Buffer.from([0x00, 0x00]);
            let bf: Buffer = Buffer.from([VER, REP, RSV, ATYP, ...BND_ADDR, ...BND_PORT]);
            socket.write(bf);
            stage = Stage.DELIVER;

            remoteHost.on('data', (data: Buffer) => {
                socket.write(data);
            });
        });

        remoteHost.on('error', (err: Error) => {
            logger.error(`远端出错, 关闭链接!`);
            remoteHost.end();
            socket.end();
        });


        remoteHost.on('close', (hadError: boolean) => {
            logger.info(`远端链接关闭!`);
            // 链接关闭
            remoteHost.end();
            socket.end();
        });
    }

    // FIXME 未处理粘包、拆包的问题
    socket.on('data', (buffer: Buffer) => {
        try {
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
                    logger.info(`VER = ${VER}, NMETHODS = ${NMETHODS}, METHODS = ${JSON.stringify(METHODS)}`);
                    let bf = Buffer.from([0x05, 0x00]);
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
                    if (VER != 0x05) {
                        logger.warn(`仅支持socks5协议, 客户端发送的VER = ${VER}`);
                        socket.end();
                        return;
                    }
                    let CMD = buffer[1];
                    if (CMD != 0x01) { // 仅支持CONNECT
                        // 0x01  CONNECT
                        // 0x02  BIND : 用于目标主机需要主动连接客户机的情况（如 FTP 协议）
                        // 0x03  UDP ASSOCIATE : UDP 协议的
                        logger.warn(`仅支持CONNECT 当前CMD= ${CMD}`);
                        socket.end();
                        return;
                    }
                    let RSV = buffer[2];
                    let ATYP = buffer[3];
                    if (ATYP == 0x01) { // IPv4
                        let ip: string = `${buffer[4]}.${buffer[5]}.${buffer[6]}.${buffer[7]}`;
                        let port: number = buffer[8] * 255 + buffer[9];
                        logger.info(`ATYPE = 0x01, ip = ${ip}, port = ${port}`);
                        onConnect(ip, port);
                    } else if (ATYP == 0x03) { // 域名
                        let domainLen: number = buffer[4];
                        let domain: string = buffer.subarray(5, 5 + domainLen).toString();
                        let port: number = buffer[5 + domainLen] * 255 + buffer[5 + domainLen + 1];
                        logger.info(`ATYPE = 0x03, domainName = ${domain}, port = ${port}`);
                        onConnect(domain, port);
                    } else if (ATYP == 0x04) { // IPv6
                        logger.error(`暂时不支持IPv6地址!`);
                        socket.end();
                    } else { // 非法的ATYPE
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
        } catch (error) {
            logger.error(`处理数据时发生错误! error = ${error}`);
            if (remoteHost)
                remoteHost.end();
            socket.end();
        }

    });

    socket.on('close', (hadError: boolean) => {
        logger.info(`客户端链接断开! hadError = ${hadError}`);
        if (remoteHost)
            remoteHost.end();
        socket.end();
    });
    socket.on('error', (err: Error) => {
        logger.error(`客户端链接异常! err = ${err}`);
        if (remoteHost)
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