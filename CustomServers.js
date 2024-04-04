const child_process = require("child_process");
const exec = require('child_process').exec;
const statuses = {
    "ONLINE": "online", "STARTING": "starting", "BUSY": "busy", "OFFLINE": "offline",
}
const types = {
    "GENERIC": "generic",
    "MINECRAFT": "minecraft",
    "ARMA": "arma",
}

class GenericServer {
    constructor({
                    port,
                    htmlID,
                    displayName,
                    path = '',
                    status = statuses.OFFLINE,
                    type = types.GENERIC,
                }) {
        this.port = port;
        this.htmlID = htmlID;
        this.displayName = displayName;
        this.status = status;
        this.path = path;
        this.type = type;
    }

    // Check if port is being used
    updateStatus() {
        exec(`netstat -an | find "${this.port}"`, (error, stdout, stderr) => {
            if (stderr) {
                console.log(`[${this.htmlID}] netstat failed: ${stderr}`)
            }
            if (stdout !== "") {
                if (!stdout.includes("WAIT"))
                    this.status = statuses.ONLINE;
                else {
                    this.status = statuses.OFFLINE;
                }
            }
            else {
                if (this.status !== statuses.STARTING)
                    this.status = statuses.OFFLINE;
            }
        })
    }

    // Run check periodically to see if the server is still up
    // TODO: Make it work with local variable instead
    lastStatus = statuses.OFFLINE

    statusMonitor(emitFunc, socket, event, servers) {
        setInterval(() => {
            if (this.lastStatus !== this.status) {
                console.log(`[${this.htmlID}]: Status changed to "${this.status}"`);
                emitFunc(socket, event, servers);
            }
            this.lastStatus = this.status;
            this.updateStatus()
        }, 500);
    }

    // For servers with executable linked
    exitCheck(server) {
        server.currProcess.on('error', (error) => {
            console.error(error)
            server.status = statuses.OFFLINE;

        });

        server.currProcess.stderr.on('data', (data) => {
            console.error(`[${this.htmlID}] [stderr]: ` + data)
        });

        server.currProcess.on('exit', () => {
            console.log(`[${server.htmlID}]: Server process ended`);
            server.status = statuses.OFFLINE;
        })
    }
}

class MinecraftServer extends GenericServer {
    constructor({
                    port, htmlID, displayName, path = '', status = statuses.OFFLINE,
                    currProcess = null,
                    currPlayers = [],
                    maxPlayers = 0,
                    startArgs = ["-jar", "minecraft_server.1.12.2.jar", "nogui"]
                }) {
        super({port, htmlID, displayName, path, status});

        this.type = types.MINECRAFT;
        this.currProcess = currProcess;
        this.currPlayers = currPlayers;
        this.maxPlayers = maxPlayers;
        this.startArgs = startArgs;
    }

    // Check if port is busy, update server status
    updateStatus() {
        exec(`netstat -an | find "${this.port}"`, (error, stdout, stderr) => {
            if (stderr) {
                console.log(stderr)
            }
            if (stdout !== "") {
                if (stdout.includes("LISTENING"))
                    this.status = statuses.ONLINE;
                else if (this.status !== statuses.STARTING)
                    this.status = statuses.OFFLINE;
            }
            else {
                if (this.status !== statuses.STARTING)
                    this.status = statuses.OFFLINE;
            }
        })
    }

    startServer(emitFunc, socket, servers) {
        console.log(`[${this.htmlID}]: Starting server`)
        const child_process = require('child_process');
        this.status = statuses.STARTING;

        this.currProcess = child_process.spawn(
            "java",
            this.startArgs,
            {cwd: this.path}
        );

        // Check for process exit
        this.exitCheck(this);

        // Check player count after servers starts
        let firstCheck = true;
        // Send list command to get player count when first launched (required to get maxPlayers)
        this.sendCommand('list')

        // Server output stream
        this.currProcess.stdout.on('data', (data) => {
            // Convert output to string
            let output = data + '';

            // Get maxPlayers when server starts
            if (firstCheck && output.includes("players online")) {
                // Remove unnecessary information
                const pureMsg = output.split(':')[3]
                // Split current and max player
                const playerNumbers = pureMsg.split('/')
                // Filter out whatever is not a number
                this.maxPlayers = this.extractNums(playerNumbers[1])
                // Set flag so this only runs once
                firstCheck = false;

                // Send updated servers to client
                emitFunc(socket, "status_response", servers);
            }

            // Add player to current players
            if (output.includes("joined the game")) {
                this.currPlayers.push(this.getPlayerName(output));

                // Send updated servers to client
                emitFunc(socket, "status_response", servers);
            }
            // Remove player from current players
            if (output.includes("left the game")) {
                const index = this.currPlayers.indexOf(this.getPlayerName(output))
                this.currPlayers.splice(index, this.currPlayers.length)

                // Send updated servers to client
                emitFunc(socket, "status_response", servers);
            }
        })


    }

    sendCommand(command) {
        if (this.currProcess !== null) {
            this.currProcess.stdin.write(command + " \n");
        }
        else {
            console.log("Command failed: server process is null");
        }
    }

    stopServer() {
        console.log(`${this.htmlID}: Stopping server`);
        this.sendCommand('stop');
    }

    extractNums(str) {
        let res = '';
        for (const char of str) {
            if (char >= '0' && char <= '9') {
                res += char;
            }
        }
        return Number(res)
    }

    getPlayerName(outputStr) {
        // Remove unnecessary information
        const filtered = outputStr.split(':')[3]
        // Return player's name
        return filtered.split(' ')[1];
    }
}

class ArmaServer extends GenericServer {
    constructor({
                    port, htmlID, displayName, path = '', status = statuses.OFFLINE,
                    startArgs, currProcess = null,
                }) {
        super({port, htmlID, displayName, path, status});

        this.type = types.ARMA;
        this.startArgs = startArgs;
        this.currProcess = currProcess;
    }

    startServer() {
        console.log(`[${this.htmlID}]: Starting server`)
        this.status = statuses.STARTING;

        this.currProcess = child_process.execFile(
            this.path,
            [this.startArgs]
        );

        // Check for process exit
        this.exitCheck(this);

    }

    stopServer() {
        console.log(`${this.htmlID}: Stopping server`);
        this.currProcess.kill();
    }
}

module.exports = {
    ArmaServer,
    GenericServer,
    MinecraftServer,
    statuses,
    types
}