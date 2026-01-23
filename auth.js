// auth.js - Authenticatie (Login & Registratie)

// JOUW SUPABASE GEGEVENS:
const SUPABASE_URL = 'https://zisirffmoiezwfcidezc.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inppc2lyZmZtb2llendmY2lkZXpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxNzUwMDYsImV4cCI6MjA4NDc1MTAwNn0.rVcLHYlGREqGeaX0W7r7RX9y0X9NdnwY_RQsb1508OU';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
window.supabase = supabaseClient; // Maak globaal beschikbaar voor scripts

let currentUser = null;
let isLoginMode = true; // We beginnen in Login modus

// --- DOM Elementen ---
const loginScreen = document.getElementById('login-screen');
const appContainer = document.querySelector('.app-container');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const actionBtn = document.getElementById('auth-action-btn');
const toggleBtn = document.getElementById('toggle-auth-btn');
const authTitle = document.getElementById('auth-title');
const toggleText = document.getElementById('auth-toggle-text');
const authError = document.getElementById('auth-error');
const logoutBtn = document.getElementById('logout-btn');

// --- Global Auth Object ---
window.supabaseAuth = {
    isLoggedIn: () => !!currentUser,
    getCurrentUser: () => currentUser,
    
    // Lijst ophalen
    async listActivities() {
        if (!currentUser) return [];
        const { data, error } = await supabaseClient
            .from('activities')
            .select('*')
            .eq('user_id', currentUser.id)
            .order('ride_date', { ascending: false });
        
        if (error) throw error;
        
        // Data conversie
        return data.map(d => ({
            ...d,
            fileName: d.file_name,
            summary: d.summary,
            fileBlob: new Blob([new Uint8Array(d.file_data)], { type: 'application/xml' })
        }));
    },

    // Opslaan
    async saveActivity({ fileBlob, fileName, summary }) {
        if (!currentUser) throw new Error("Niet ingelogd");
        const arrayBuffer = await fileBlob.arrayBuffer();
        const fileArray = Array.from(new Uint8Array(arrayBuffer));

        const { data, error } = await supabaseClient
            .from('activities')
            .insert({
                user_id: currentUser.id,
                file_name: fileName,
                file_data: fileArray, 
                summary: summary,
                ride_date: summary.rideDate || new Date().toISOString()
            });
        if (error) throw error;
        return data;
    }
};

// --- LOGICA ---

// 1. Check Sessie
async function checkSession() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        handleLoginSuccess(session.user);
    } else {
        loginScreen.style.display = 'flex';
    }
}

// 2. Wissel tussen Login en Registreer
function toggleAuthMode(e) {
    if(e) e.preventDefault(); // Voorkom dat de link de pagina herlaadt
    
    isLoginMode = !isLoginMode; // Switch true/false
    authError.style.display = 'none'; // Verberg oude errors

    if (isLoginMode) {
        // Login Stand
        authTitle.innerText = "Log in om verder te gaan";
        actionBtn.innerText = "Inloggen";
        toggleText.innerText = "Nog geen account?";
        toggleBtn.innerText = "Maak account";
        actionBtn.style.background = "#fc4c02"; // Oranje
    } else {
        // Registreer Stand
        authTitle.innerText = "Maak een nieuw account";
        actionBtn.innerText = "Registreren";
        toggleText.innerText = "Heb je al een account?";
        toggleBtn.innerText = "Log hier in";
        actionBtn.style.background = "#28a745"; // Groen (voor onderscheid)
    }
}

// 3. De Actie (Klik op knop)
async function handleAuthAction() {
    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();
    
    if(!email || !password) {
        showError("Vul alle velden in.");
        return;
    }
    if(password.length < 6) {
        showError("Wachtwoord moet minimaal 6 tekens zijn.");
        return;
    }

    authError.style.display = 'none';
    actionBtn.innerText = "Laden...";
    actionBtn.disabled = true;

    try {
        if (isLoginMode) {
            // INLOGGEN
            const { data, error } = await supabaseClient.auth.signInWithPassword({
                email, password
            });
            if (error) throw error;
            handleLoginSuccess(data.user);
        } else {
            // REGISTREREN
            const { data, error } = await supabaseClient.auth.signUp({
                email, password
            });
            if (error) throw error;
            
            // Auto-login werkt vaak direct als 'Confirm Email' uit staat in Supabase
            if(data.session) {
                handleLoginSuccess(data.session.user);
            } else {
                alert("Registratie gelukt! Controleer je email of log nu in.");
                // Switch terug naar login scherm
                toggleAuthMode();
                actionBtn.innerText = "Inloggen";
                actionBtn.disabled = false;
            }
        }
    } catch (error) {
        console.error(error);
        showError(error.message);
        actionBtn.innerText = isLoginMode ? "Inloggen" : "Registreren";
        actionBtn.disabled = false;
    }
}

function handleError(msg) {
    authError.innerText = msg;
    authError.style.display = 'block';
}

function showError(msg) {
    // Vertaal veelvoorkomende Engelse errors naar Nederlands
    if(msg.includes("Invalid login credentials")) msg = "Ongeldig email of wachtwoord.";
    if(msg.includes("User already registered")) msg = "Dit emailadres is al in gebruik.";
    
    authError.innerText = msg;
    authError.style.display = 'block';
}

function handleLoginSuccess(user) {
    currentUser = user;
    console.log("Ingelogd:", user.email);
    
    loginScreen.style.display = 'none';
    appContainer.classList.remove('hidden');
    
    // Initialiseer UI
    if(window.updateDashboard) window.updateDashboard();
    if(window.switchTab) window.switchTab('dashboard');
}

// Event Listeners
if(actionBtn) actionBtn.addEventListener('click', handleAuthAction);
if(toggleBtn) toggleBtn.addEventListener('click', toggleAuthMode);

if(logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        window.location.reload();
    });
}

// Start
document.addEventListener('DOMContentLoaded', checkSession);