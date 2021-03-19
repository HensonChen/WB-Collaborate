import { io } from "socket.io-client";
import Peer from "simple-peer";
import React, { useContext, createContext, useEffect, useState } from "react";

export interface DrawData {
    path: any
}

export const PBContext = createContext({
    peerBroadcast: (data: DrawData) => {}
});

export const usePBContext = () => {
    return useContext(PBContext);
}

interface PConnProps {
    draw: (path: any) => void
}

const PeerConnecion: React.FC<PConnProps> = ({ draw, children }) => {
    const [roomId, setRoomId] = useState<string>("000000");
    const [token, setToken] = useState<string>("abc");
    const [selfSocketId, setSelfSocketId] = useState<string>('');
    const [allSocketIds, setAllSocketIds] = useState<string[]>([]);
    const [peerConnections, setPeerConnections] = useState<{[socketId:string]:any}>({});
    const [socket, setSocket] = useState<any>(null)

    useEffect(() => {
        // connect the server by passing in auth token and roomId
        const sok = io('ws://localhost:5001', {
            auth: {
                token: token
            },
            query: {
                "roomId": roomId
            },
            reconnectionAttempts: 10
        });

        setSocket(sok);

        // clean up effect when unmounting
        return (() => {
            if (socket)
               socket.disconnect()
            return;
        });
    },[]);

    useEffect( () => {
        if (!socket) return
        // receive self socket id when connected to the server
        socket.on('init', (data:{selfId:string, allUserIds:string[]}) => {
            setSelfSocketId(data.selfId);
            setAllSocketIds(data.allUserIds);
        });

        // keep all connected user id updated and establish simple-peer connection to them
        socket.on('allUserIds', (users:string[]) => {
            setAllSocketIds(users);
            console.log("AllSocketIDs", allSocketIds);
        });

        // signal the data passed by peer
        socket.on('hello', (data:{initiatorId:string, signalData:any}) => {
            signal(data.initiatorId, data.signalData);
        });
    }, [socket])

    useEffect( () => {
        console.log("Self ID", selfSocketId);
        console.log("AllSocketID", allSocketIds);
        connectPeers();
    }, [selfSocketId, allSocketIds])

    function callPeer(index:number) {
        if (index >= allSocketIds.length) return;
        const id = allSocketIds[index];
        // return if connect to self or already connected
        if (id === selfSocketId || peerConnections[id]) return;
        const peer = new Peer({
            initiator: true,
            trickle: false
        });
    
        peer.on('signal', (signalData:any) => {
            socket.emit("notifyPeers", { to: id, signalData: signalData, from: selfSocketId })
        })
        peer.on('error', console.error);
        peer.on('connect', () => {
            console.log(selfSocketId + " successfully connected to " + id);
            callPeer(index+1);
        });
        peer.on('data', (data:string) => {
            onPeerData(data);
        });
    
        // finalize connection if connection accepted
        socket.on('accepted', (signalData:any) => {
            peer.signal(signalData);
            const { [id]: tmp, ...conns } = peerConnections;
            setPeerConnections({ [id]: peer, ...conns });
        });
    }

    function connectPeers() {
        // destroy p2p connection to disconnected user
        Object.keys(peerConnections).forEach(id => {
            if (!allSocketIds.includes(id)) {
                const { [id]: tmp, ...conns } = peerConnections;
                setPeerConnections(conns);
            }
        });
        // establish new p2p connection
        callPeer(0);
    }
    
    function signal(initiator:string, initiatorData:any) {
        console.log("Running signal");
        const peer = new Peer({
            initiator: false,
            trickle: false
        });
        peer.on('signal', (signalData:any) => {
            socket.emit("acceptConn", { signalData: signalData, to: initiator })
        });
        peer.on('data', (data:any) => {
            onPeerData(data);
        });
        peer.on('connect', () => {
            console.log(selfSocketId + " successfully connected to " + initiator);
        });
        peer.signal(initiatorData);
        const { [initiator]: tmp, ...conns } = peerConnections;
        setPeerConnections({ [initiator]: peer, ...conns });
    }

    function peerBroadcast(data:DrawData) {
        Object.values(peerConnections).forEach(peer => {
            try {
                peer.on('connect', () => {
                    peer.send(data);
                });
            } catch (err) {
                console.error(err);
            }
        });
    }
    
    function onPeerData(data:string) {
        // TODO: define this function to draw
        draw(JSON.parse(String(data)).path);
        // console.log("received", String(data));
    }

    return (
        <PBContext.Provider value={{peerBroadcast}}>
            {children}
        </PBContext.Provider>
    );
}

export default PeerConnecion;