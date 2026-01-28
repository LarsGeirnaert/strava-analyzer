// auth.js - Authenticatie, Database & Gemeente Opslag

const SUPABASE_URL = 'https://zisirffmoiezwfcidezc.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inppc2lyZmZtb2llendmY2lkZXpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxNzUwMDYsImV4cCI6MjA4NDc1MTAwNn0.rVcLHYlGREqGeaX0W7r7RX9y0X9NdnwY_RQsb1508OU';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
window.supabase = supabaseClient;

let currentUser = null;
let isLoginMode = true;

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

window.supabaseAuth = {
    isLoggedIn: () => !!currentUser,
    getCurrentUser: () => currentUser,
    
    // 1. LIJST OPHALEN
    async listActivities() {
        if (!currentUser) return [];
        const { data, error } = await supabaseClient
            .from('activities')
            .select('id, user_id, file_name, summary, ride_date') 
            .eq('user_id', currentUser.id)
            .order('ride_date', { ascending: false });
        
        if (error) throw error;
        return data.map(d => ({ ...d, fileName: d.file_name }));
    },

    // 2. BESTAND OPHALEN
    async getActivityFile(id) {
        const { data, error } = await supabaseClient
            .from('activities')
            .select('file_data')
            .eq('id', id)
            .single();
            
        if (error) throw error;
        return new Blob([new Uint8Array(data.file_data)], { type: 'application/xml' });
    },

    // 3. RIT OPSLAAN
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
            })
            .select();
            
        if (error) throw error;
        return data;
    },

    // 4. ACTIVITEIT UPDATEN (DEZE WAS JE KWIJT!)
    async updateActivitySummary(id, newSummary) {
        if (!currentUser) throw new Error("Niet ingelogd");
        const { error } = await supabaseClient
            .from('activities')
            .update({ summary: newSummary })
            .eq('id', id);
        
        if (error) throw error;
    },

    // 5. VERWIJDEREN
    async deleteActivities(idsArray) {
        if (!currentUser) throw new Error("Niet ingelogd");
        const { error } = await supabaseClient
            .from('activities')
            .delete()
            .in('id', idsArray);
        if (error) throw error;
    },

    // 6. GEMEENTES OPSLAAN
    async saveConqueredMunicipalities(namesArray) {
        if (!currentUser || !namesArray || namesArray.length === 0) return;
        const records = namesArray.map(name => ({
            user_id: currentUser.id,
            municipality_name: name
        }));
        const { error } = await supabaseClient
            .from('user_municipalities')
            .upsert(records, { onConflict: 'user_id, municipality_name', ignoreDuplicates: true });
        if (error) console.error("Fout bij opslaan gemeentes:", error);
    },

    // 7. GEMEENTES OPHALEN
    async getConqueredMunicipalities() {
        if (!currentUser) return [];
        const { data, error } = await supabaseClient
            .from('user_municipalities')
            .select('municipality_name');
            
        if (error) { console.error(error); return []; }
        return data.map(row => row.municipality_name);
    }
};

// --- AUTH UI LOGICA ---
async function checkSession() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) handleLoginSuccess(session.user);
    else loginScreen.style.display = 'flex';
}

function toggleAuthMode(e) {
    if(e) e.preventDefault();
    isLoginMode = !isLoginMode;
    if(authError) authError.style.display = 'none';

    if (isLoginMode) {
        authTitle.innerText = "Log in om verder te gaan";
        actionBtn.innerText = "Inloggen";
        toggleText.innerText = "Nog geen account?";
        toggleBtn.innerText = "Maak account";
        actionBtn.style.background = "#fc4c02"; 
    } else {
        authTitle.innerText = "Maak een nieuw account";
        actionBtn.innerText = "Registreren";
        toggleText.innerText = "Heb je al een account?";
        toggleBtn.innerText = "Log hier in";
        actionBtn.style.background = "#28a745"; 
    }
}

async function handleAuthAction() {
    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();
    if(!email || !password) { showError("Vul alle velden in."); return; }
    if(authError) authError.style.display = 'none';
    actionBtn.innerText = "Laden..."; actionBtn.disabled = true;

    try {
        if (isLoginMode) {
            const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) throw error;
            handleLoginSuccess(data.user);
        } else {
            const { data, error } = await supabaseClient.auth.signUp({ email, password });
            if (error) throw error;
            if(data.session) handleLoginSuccess(data.session.user);
            else { alert("Registratie gelukt! Je kunt nu inloggen."); toggleAuthMode(); }
        }
    } catch (error) {
        console.error(error); showError(error.message);
    } finally {
        actionBtn.innerText = isLoginMode ? "Inloggen" : "Registreren";
        actionBtn.disabled = false;
    }
}

function showError(msg) {
    if(msg.includes("Invalid login")) msg = "Ongeldig email of wachtwoord.";
    if(authError) {
        authError.innerText = msg; 
        authError.style.display = 'block';
    } else {
        alert(msg);
    }
}

function handleLoginSuccess(user) {
    currentUser = user;
    loginScreen.style.display = 'none';
    appContainer.classList.remove('hidden');
    if(window.updateDashboard) window.updateDashboard();
    if(window.switchTab) window.switchTab('dashboard');
}

if(actionBtn) actionBtn.addEventListener('click', handleAuthAction);
if(toggleBtn) toggleBtn.addEventListener('click', toggleAuthMode);
if(logoutBtn) logoutBtn.addEventListener('click', async () => { await supabaseClient.auth.signOut(); window.location.reload(); });
document.addEventListener('DOMContentLoaded', checkSession);