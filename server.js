const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({server});

app.use(express.static("public"));

// 接続中ユーザー
let users = new Map();
let messages = [];
let pinnedMessages = [];
let boardHistory = [];
let boardClients = [];
let reactions = {};
let reactionUsers = {};
let tasks = [];

//ユーザー追加
const accounts = {

    //管理者
    "TSUJIMURA":{
        password:"a9535vpax",
        role:"admin",
        rooms:["room1","room2","room3","room4","KEEPALIVE"]
    },

    //利用者1
    "INO":{
        password:"n7379",
        role:"user",
        rooms:["room1"]
    },

    //利用者2
    "MIYUKI":{
        password:"1400",
        role:"user",
        rooms:["room2"]
    },

    //利用者3
    "NENE":{
        password:"0616",
        role:"user",
        rooms:["room2","room3"]
    },

    //利用者4
    "SHINO":{
        password:"130931",
        role:"user",
        rooms:["room4"]
    }

};

wss.on("connection", (ws) => {

    // 接続ごとにID発行
    const id = crypto.randomUUID();

    boardClients.push(ws);

    users.set(ws, {
        id:id,
        name:"",
        role:"",
        room:""
    });

    ws.send(JSON.stringify({
        type: "id",
        id: id
    }));

    ws.on("message", (message) => {

        const data = JSON.parse(message);
        const user = users.get(ws);

        if (data.type === "keepAlive")
        {

            if (user.role !== "admin")
            {
                return;
            }

            const keepAliveMessage = {

                type:"message",
                messageId:crypto.randomUUID(),
                room:"KEEPALIVE",
                id:user.id,
                name:user.name,
                text:"keepalive",
                urgent:false,
                replyTo:null,
                replyName:null,
                replyText:null,
                time:new Date().toLocaleTimeString("ja-JP", {
                    timeZone:"Asia/Tokyo",
                    hour:"2-digit",
                    minute:"2-digit"
                })
            };

            broadcastRoom(
                "KEEPALIVE",
                keepAliveMessage
            );

            return;
        }

        if ( data.type === "start" ||
            data.type === "draw")
        {
            boardHistory.push(data);

            broadcastBoard(
                data.room,
                data
            );

            return;
        }

        if (data.type === "clear")
        {
            boardHistory =
                boardHistory.filter(
                    item => item.room !== data.room);

            broadcastRoom(
                data.room,
                data
            );

            return;
        }

        if (data.type === "boardJoin")
        {
            ws.boardRoom = data.room;
            ws.clientId = data.clientId;

            boardHistory.forEach((item)=>{

                if (item.room === data.room)
                {
                    ws.send(JSON.stringify(item));
                }
            });

            return;
        }

        // 入室
        if (data.type === "join")
        {

            if (data.room !== "ALL" &&
                !accounts[data.name])
            {
                ws.send(JSON.stringify({

                    type:"error",
                    message:"登録されていないユーザーです"

                }));

                return;
            }

            if (accounts[data.name] &&
                accounts[data.name].password &&
                accounts[data.name].password !== data.password)
            {

                ws.send(JSON.stringify({

                    type:"error",
                    message:"パスワードが違います"

                }));

                return;
            }

            if (data.room !== "ALL" &&
                !accounts[data.name].rooms.includes(data.room))
            {

                ws.send(JSON.stringify({

                    type:"error",
                    message:"この部屋には入室できません"

                }));

                return;
            }

            user.name = data.name;
            
            if (accounts[data.name])
            {
                user.role = accounts[data.name].role;
            }
            else
            {
                user.role = "guest";
            }
            user.room = data.room;

            broadcastRoom(
                user.room,
                {
                    type:"system",
                    message:user.name + " さんが入室しました"
                }
            );

            messages.forEach((msg)=>{
                if (msg.room === user.room)
                {
                    ws.send(JSON.stringify({
                        ...msg,
                        history:true
                    }));
                }
            });

            sendUserList();

            return;
        }

        if (data.type === "file")
        {

            broadcastRoom(
                user.room,
                {
                    type:"file",

                    id:user.id,

                    name:user.name,

                    fileName:data.name,

                    fileData:data.data

                }
            );


            return;

        }

        if (data.type === "image")
        {
            broadcastRoom(
                user.room,
                {
                    type:"image",
                    id:user.id,
                    name:user.name,
                    image:data.image
                }
            );

            return;
        }

        if (data.type === "typing")
        {
            broadcastRoom(
                user.room,
                {
                    type:"typing",
                    id:user.id,
                    name:user.name,
                    typing:data.typing
                }
            );

            return;
        }

        if (data.type === "reaction")
        {

            const key = data.messageId + "_" + data.emoji;
            const userKey = data.messageId + "_" + user.id;

            if (!reactionUsers[userKey])
            {
                reactionUsers[userKey] = [];
            }

            const index =
                reactionUsers[userKey].indexOf(
                    data.emoji
                );

            // すでに押している場合は解除
            if (index !== -1)
            {
                reactionUsers[userKey].splice(
                    index,
                    1
                );

                reactions[key]--;

                if(reactions[key] <= 0)
                {
                    delete reactions[key];
                }
            }
            else
            {
                reactionUsers[userKey].push(
                    data.emoji
                );

                if(!reactions[key])
                {
                    reactions[key] = 0
                }

                reactions[key]++;
            }

            const counts = {};

            Object.keys(reactions).forEach((key)=>{

                if (key.startsWith(data.messageId + "_"))
                {
                    const emoji = key.split("_")[1];

                    counts[emoji] = reactions[key];
                }
            });

            broadcastRoom(
                user.room,
                {
                    type:"reaction",
                    messageId:data.messageId,
                    counts:counts
                }
            );
            
            return;

        }

        //リアクション
        if (data.type === "reaction")
        {

            broadcastRoom(
                user.room,
                {
                    type:"reaction",
                    messageId:data.messageId,
                    emoji:data.emoji
                }
            );

            return;
        }

        //既読
        if (data.type === "read")
        {
            broadcastRoom(
                user.room,
                {
                    type:"read",
                    messageId:data.messageId,
                    user:user.name
                }
            );

            return;
        }

        //ピン止め
        if (data.type === "pin")
        {
            pinnedMessages.push({
                id: crypto.randomUUID(),
                text:data.text,
                name:user.name
            });

            broadcastRoom(
                user.room,
                {
                    type:"pin",
                    pinnedMessages:pinnedMessages
                }
            );

            return;
        }

        //ピン止め解除
        if (data.type === "unpin")
        {
            pinnedMessages = pinnedMessages.filter(msg => msg.id !== data.id);

            broadcastRoom(
                user.room,
                {
                    type:"pin",
                    pinnedMessages:pinnedMessages
                }
            );

            return;
        }

        if (data.type === "clearChat")
        {
            if (user.name !== "TSUJIMURA")
            {
                ws.send(JSON.stringify({
                    type:"error",
                    message:"権限がありません"
                }));

                return;
            }

            messages =
                messages.filter(
                    msg => msg.room !== user.room
                );

            broadcastRoom(
                user.room,
                {
                    type:"clearChat"
                }
            );

            return;
        }

        if (data.type === "stamp")
        {

            const stampData = {

                type:"stamp",

                id:user.id,

                name:user.name,

                stamp:data.stamp,

                room:user.room,

                time:new Date().toLocaleTimeString(
                    "ja-JP",
                    {
                        hour:"2-digit",
                        minute:"2-digit"
                    }
                )

            };


            broadcastRoom(
                user.room,
                stampData
            );


            return;

        }

        if (data.type === "createTask")
        {

            const task = {
                id:crypto.randomUUID(),
                room:user.room,
                text:data.text,
                name:user.name,
                assignee:data.assignee,
                status:"todo"
            };

            tasks.push(task);

            broadcastRoom(
                user.room,
                {
                    type:"task",
                    task:task
                }
            );

            return;

        }

        if(data.type === "toggleTask")
        {

            const task =
                tasks.find(
                    task => task.id === data.taskId
                );

            if (!task)
            {
                return;
            }

            if(task.status === "todo"){

                task.status = "progress";
            }
            else if(task.status === "progress"){
                task.status = "done";
            }
            else{
                task.status = "todo";
            }

            broadcastRoom(
                task.room,
                {
                    type:"taskUpdate",
                    task:task
                }
            );

            return;
        }

        if(data.type === "editMessage")
        {

            const target =
                messages.find(
                    msg =>
                        msg.messageId === data.messageId
                );

            if(!target){
                return;
            }

            // 自分のメッセージだけ編集可能
            if(target.id !== user.id){

                ws.send(JSON.stringify({

                    type:"error",

                    message:"自分のメッセージだけ編集できます"

                }));

                return;
            }

            target.text =
                data.text;

            broadcastRoom(
                target.room,
                {
                    type:"editMessage",
                    messageId:
                        target.messageId,
                    text:
                        target.text
                }
            );

            return;
        }

        if(data.type === "deleteMessage")
        {

            const index =
                messages.findIndex(
                    msg =>
                        msg.messageId === data.messageId
                );

            if(index === -1){
                return;
            }

            const target = messages[index];

            // 自分のメッセージだけ削除可能
            if(target.id !== user.id){
                ws.send(JSON.stringify({
                    type:"error",
                    message:"自分のメッセージだけ削除できます"
                }));
                return;
            }

            messages.splice(
                index,
                1
            );

            broadcastRoom(
                target.room,
                {
                    type:"deleteMessage",
                    messageId:
                        target.messageId
                }
            );
            return;
        }

        if (data.type === "message")
        {
            const messageData = {
                type:"message",
                messageId: crypto.randomUUID(),
                room:user.room,
                id:user.id,
                name:user.name,
                text:data.text,
                urgent:data.urgent,
                replyTo:data.replyTo,
                replyName:data.replyName,
                replyText:data.replyText,

                time:new Date().toLocaleTimeString("ja-JP", {
                    timeZone:"Asia/Tokyo",
                    hour:"2-digit",
                    minute:"2-digit"
                })
            };

            // 履歴へ保存
            messages.push(messageData);

            // 直近100件だけ残す
            if (messages.length > 100)
            {
                messages.shift();
            }
            
            broadcastRoom(user.room, messageData);
        }
    });



    ws.on("close", () => {

        const user = users.get(ws);

        if (user && user.name)
        {
            broadcastRoom(
                user.room,
                {
                    type:"system",
                    message:user.name + " さんが退出しました"
                }
            );
        }

        users.delete(ws);
        sendUserList();

    });
});

// 全員へ送信
function broadcastRoom(room, data)
{
    users.forEach((user, client)=>{
        if(user.room === room){
            client.send(JSON.stringify(data));
        }
    });
}

function broadcastBoard(room, data){
    boardClients.forEach((client)=>{
        if (client.readyState === WebSocket.OPEN &&
            client.boardRoom === room &&
            client.clientId !== data.clientId)
        {
            client.send(JSON.stringify(data));
        }
    });
}   

// オンライン一覧送信
function sendUserList()
{
    users.forEach((targetUser, client)=>{
        const list = [];

        users.forEach((user)=>{
            if(
                user.name &&
                user.room === targetUser.room
            ){
                list.push(user.name);
            }
        });

        client.send(JSON.stringify({
            type:"users",
            users:list
        }));
    });
}

server.listen(process.env.PORT || 3000, () => {
    console.log(
        "チャット開始"
    );
});