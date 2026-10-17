import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const NotificationContext = createContext();

export const useNotification = () => useContext(NotificationContext);

export const NotificationProvider = ({ children }) => {

    const [localuser, setLocaluser] = useState(() => {
        try {
            const stored = localStorage.getItem("user");
            // handle cases where it's undefined, null, or "undefined"
            if (!stored || stored === "undefined") return null;
            return JSON.parse(stored);
        } catch (e) {
            console.error("Error parsing localStorage user:", e);
            return null;
        }
    });

    // Sandbox port fix: re-read the stored user when the auth session changes.
    useEffect(() => {
        const refreshUser = () => {
            try {
                const stored = localStorage.getItem("user");
                if (!stored || stored === "undefined") { setLocaluser(null); return; }
                setLocaluser(JSON.parse(stored));
            } catch (e) {
                setLocaluser(null);
            }
        };
        window.addEventListener("medsync-auth-changed", refreshUser);
        return () => window.removeEventListener("medsync-auth-changed", refreshUser);
    }, []);

    const [notifications, setNotifications] = useState([]);



        // Function to call backend to trigger the scheduler (keeps existing endpoint)
        const sendNotification = useCallback(async () => {
                if (!localuser) return; // prevent call if user not logged in
                try {
                        console.log("localuser in notification context:", localuser);
                        await axios.post('/api/notification/regular-notify', { localuser });
                } catch (err) {
                        console.error("Error in sending notification:", err?.message || err);
                }
        }, [localuser]);


    

        // Fetch today's stored notifications for the current user
        const fetchTodayNotifications = useCallback(async () => {
            if (!localuser) return [];
            try {
                const response = await axios.post('/api/notification/today', { localuser });
              
                const data = response.data && response.data.data ? response.data.data : [];
                setNotifications(data);
                return data;
            } catch (error) {
                console.error('Error fetching today notifications:', error);
                return [];
            }
        }, [localuser]);

    return (
        <NotificationContext.Provider value={{
            notifications,
            sendNotification,
            fetchTodayNotifications
        }}>
            {children}
        </NotificationContext.Provider>
    );
};
