// auth.js - Supabase Authenticatie voor Strava Analyzer Pro

/* ========== SUPABASE CONFIGURATIE ========== */
// Vervang met je eigen Supabase URL en anon key
const SUPABASE_URL = 'https://atxamqzgsgtcojpvewdm.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0eGFtcXpnc2d0Y29qcHZld2RtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA5NjE0MTAsImV4cCI6MjA3NjUzNzQxMH0.6aeaKU15pypjgtNrNmuKIxd7on6Wg_A0IIgOeOTcHZ0'

// Supabase client initialiseren
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

let currentUser = null

/* ========== AUTHENTICATIE FUNCTIES ========== */
async function initAuth() {
    console.log('🔐 Initialiseer authenticatie...')
    
    // Check of gebruiker al ingelogd is
    const { data: { session }, error } = await supabase.auth.getSession()
    
    if (session) {
        currentUser = session.user
        updateUIForLoggedInUser()
        console.log('✅ Gebruiker ingelogd:', currentUser.email)
        
        // Laad user's activiteiten
        await loadUserActivities()
    } else {
        showAuthModal()
        console.log('🔒 Gebruiker niet ingelogd, toon login modal')
    }
    
    // Luister naar auth state changes
    supabase.auth.onAuthStateChange((event, session) => {
        console.log('🔄 Auth state changed:', event)
        
        if (event === 'SIGNED_IN' && session) {
            currentUser = session.user
            updateUIForLoggedInUser()
            console.log('🔑 Gebruiker ingelogd:', currentUser.email)
            
            // Laad user's activiteiten
            loadUserActivities()
        } else if (event === 'SIGNED_OUT') {
            currentUser = null
            updateUIForLoggedOutUser()
            console.log('🚪 Gebruiker uitgelogd')
            
            // Terug naar lokale opslag
            initLocalStorage()
        } else if (event === 'INITIAL_SESSION') {
            console.log('📦 Initial session loaded')
        }
    })
}

async function loginUser(email, password) {
    try {
        console.log('🔐 Probeer in te loggen...')
        
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email.trim(),
            password: password
        })
        
        if (error) throw error
        
        showNotification('✅ Succesvol ingelogd!', 'success')
        hideAuthModal()
        console.log('🎉 Inloggen succesvol')
        return data.user
    } catch (error) {
        console.error('❌ Inloggen mislukt:', error)
        showNotification(`❌ Inloggen mislukt: ${error.message}`, 'error')
        throw error
    }
}

async function registerUser(email, password) {
    try {
        console.log('📝 Probeer te registreren...')
        
        if (password.length < 6) {
            throw new Error('Wachtwoord moet minimaal 6 tekens lang zijn')
        }
        
        const { data, error } = await supabase.auth.signUp({
            email: email.trim(),
            password: password,
        })
        
        if (error) throw error
        
        showNotification('✅ Account aangemaakt! Je kunt nu inloggen.', 'success')
        switchToLoginTab()
        console.log('🎉 Registratie succesvol')
        return data.user
    } catch (error) {
        console.error('❌ Registratie mislukt:', error)
        showNotification(`❌ Registratie mislukt: ${error.message}`, 'error')
        throw error
    }
}

async function logoutUser() {
    try {
        console.log('🚪 Probeer uit te loggen...')
        
        const { error } = await supabase.auth.signOut()
        if (error) throw error
        
        showNotification('🚪 Succesvol uitgelogd', 'success')
        currentUser = null
        updateUIForLoggedOutUser()
        console.log('✅ Uitloggen succesvol')
    } catch (error) {
        console.error('❌ Uitloggen mislukt:', error)
        showNotification(`❌ Uitloggen mislukt: ${error.message}`, 'error')
    }
}

/* ========== UI FUNCTIES ========== */
function showAuthModal() {
    console.log('🪟 Toon auth modal')
    document.getElementById('authModal').classList.remove('hidden')
    document.body.style.overflow = 'hidden' // Voorkom scrollen
}

function hideAuthModal() {
    console.log('❌ Verberg auth modal')
    document.getElementById('authModal').classList.add('hidden')
    document.body.style.overflow = '' // Herstel scrollen
    
    // Reset form fields
    document.getElementById('loginEmail').value = ''
    document.getElementById('loginPassword').value = ''
    document.getElementById('registerEmail').value = ''
    document.getElementById('registerPassword').value = ''
}

function updateUIForLoggedInUser() {
    console.log('🎨 Update UI voor ingelogde gebruiker')
    
    document.getElementById('authModal').classList.add('hidden')
    document.getElementById('userInfo').classList.remove('hidden')
    document.getElementById('userEmail').textContent = currentUser.email
    
    // Toon de main applicatie
    document.querySelector('.container').style.display = 'block'
    document.body.style.overflow = '' // Herstel scrollen
    
    // Update user info in header
    updateUserHeader()
}

function updateUIForLoggedOutUser() {
    console.log('🎨 Update UI voor uitgelogde gebruiker')
    
    document.getElementById('userInfo').classList.add('hidden')
    document.querySelector('.container').style.display = 'none'
    showAuthModal()
}

function updateUserHeader() {
    const userHeader = document.getElementById('userHeader')
    if (userHeader) {
        userHeader.innerHTML = `
            <div class="user-welcome">
                <span class="welcome-text">Welkom, ${currentUser.email}</span>
                <button id="headerLogoutBtn" class="btn btn-secondary btn-small">
                    Uitloggen
                </button>
            </div>
        `
        
        // Event listener voor logout knop in header
        document.getElementById('headerLogoutBtn').addEventListener('click', logoutUser)
    }
}

function switchToLoginTab() {
    console.log('🔀 Switch naar login tab')
    
    document.querySelectorAll('.auth-tab').forEach(tab => tab.classList.remove('active'))
    document.querySelectorAll('.auth-form').forEach(form => form.classList.remove('active'))
    
    document.querySelector('[data-tab="login"]').classList.add('active')
    document.getElementById('loginForm').classList.add('active')
    
    // Auto-focus op email field
    setTimeout(() => {
        document.getElementById('loginEmail').focus()
    }, 100)
}

function switchToRegisterTab() {
    console.log('🔀 Switch naar register tab')
    
    document.querySelectorAll('.auth-tab').forEach(tab => tab.classList.remove('active'))
    document.querySelectorAll('.auth-form').forEach(form => form.classList.remove('active'))
    
    document.querySelector('[data-tab="register"]').classList.add('active')
    document.getElementById('registerForm').classList.add('active')
    
    // Auto-focus op email field
    setTimeout(() => {
        document.getElementById('registerEmail').focus()
    }, 100)
}

function showNotification(message, type = 'info') {
    console.log(`📢 Notification [${type}]: ${message}`)
    
    // Creëer notification element
    const notification = document.createElement('div')
    notification.className = `notification notification-${type}`
    notification.innerHTML = `
        <div class="notification-content">
            <span class="notification-message">${message}</span>
            <button class="notification-close">&times;</button>
        </div>
    `
    
    // Styling
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
        color: white;
        padding: 15px 20px;
        border-radius: 10px;
        box-shadow: 0 10px 25px rgba(0,0,0,0.2);
        z-index: 10001;
        max-width: 400px;
        animation: slideInRight 0.3s ease-out;
    `
    
    notification.querySelector('.notification-content').style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 15px;
    `
    
    notification.querySelector('.notification-close').style.cssText = `
        background: none;
        border: none;
        color: white;
        font-size: 18px;
        cursor: pointer;
        padding: 0;
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
    `
    
    // Voeg toe aan body
    document.body.appendChild(notification)
    
    // Close functionaliteit
    notification.querySelector('.notification-close').addEventListener('click', () => {
        notification.remove()
    })
    
    // Auto remove na 5 seconden
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.animation = 'slideOutRight 0.3s ease-in'
            setTimeout(() => notification.remove(), 300)
        }
    }, 5000)
}

/* ========== SUPABASE DATABASE FUNCTIES ========== */
async function saveActivityToSupabase({ fileBlob, fileName, summary }) {
    if (!currentUser) {
        throw new Error('Niet ingelogd')
    }

    console.log('💾 Opslaan in Supabase:', fileName)
    
    try {
        // Converteer blob naar Uint8Array voor Supabase
        const arrayBuffer = await fileBlob.arrayBuffer()
        const uint8Array = new Uint8Array(arrayBuffer)
        
        const { data, error } = await supabase
            .from('activities')
            .insert({
                user_id: currentUser.id,
                file_name: fileName,
                file_data: uint8Array,
                summary: summary,
                ride_date: summary.rideDate
            })
            .select()
            .single()

        if (error) {
            console.error('❌ Supabase insert error:', error)
            throw error
        }
        
        console.log('✅ Opgeslagen in Supabase:', data.id)
        return data
    } catch (error) {
        console.error('❌ Fout bij opslaan in Supabase:', error)
        throw error
    }
}

async function listActivitiesFromSupabase() {
    if (!currentUser) {
        throw new Error('Niet ingelogd')
    }

    console.log('📋 Activiteiten ophalen van Supabase...')
    
    try {
        const { data, error } = await supabase
            .from('activities')
            .select('*')
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: false })

        if (error) {
            console.error('❌ Supabase select error:', error)
            throw error
        }
        
        console.log(`✅ ${data.length} activiteiten opgehaald`)
        
        // Converteer Uint8Array data terug naar blobs
        const activities = data.map(activity => {
            // Supabase geeft file_data terug als array van numbers
            const fileDataArray = activity.file_data
            const uint8Array = new Uint8Array(fileDataArray)
            const blob = new Blob([uint8Array], { type: 'application/xml' })
            
            return {
                id: activity.id,
                fileName: activity.file_name,
                fileBlob: blob,
                summary: activity.summary,
                createdAt: activity.created_at,
                rideDate: activity.ride_date
            }
        })
        
        return activities
    } catch (error) {
        console.error('❌ Fout bij ophalen van Supabase:', error)
        throw error
    }
}

async function deleteActivityFromSupabase(id) {
    if (!currentUser) {
        throw new Error('Niet ingelogd')
    }

    console.log('🗑️ Verwijder activiteit uit Supabase:', id)
    
    try {
        const { error } = await supabase
            .from('activities')
            .delete()
            .eq('id', id)
            .eq('user_id', currentUser.id)

        if (error) {
            console.error('❌ Supabase delete error:', error)
            throw error
        }
        
        console.log('✅ Activiteit verwijderd uit Supabase')
    } catch (error) {
        console.error('❌ Fout bij verwijderen uit Supabase:', error)
        throw error
    }
}

async function loadUserActivities() {
    try {
        console.log('🔄 Laad user activiteiten...')
        
        if (currentUser) {
            // Gebruik Supabase voor ingelogde gebruikers
            const activities = await listActivitiesFromSupabase()
            console.log(`📊 ${activities.length} activiteiten geladen van Supabase`)
            
            // Update de UI met de opgehaalde activiteiten
            await updateActivitiesUI(activities)
        } else {
            // Gebruik lokale opslag voor niet-ingelogde gebruikers
            await initLocalStorage()
        }
    } catch (error) {
        console.error('❌ Fout bij laden activiteiten:', error)
        showNotification('❌ Fout bij laden activiteiten', 'error')
    }
}

/* ========== HYBRIDE OPSLAG FUNCTIES ========== */
async function saveActivity({ fileBlob, fileName, summary }) {
    console.log('💾 Opslaan activiteit:', fileName)
    
    if (currentUser) {
        // Gebruik Supabase als ingelogd
        return await saveActivityToSupabase({ fileBlob, fileName, summary })
    } else {
        // Gebruik lokale IndexedDB als niet ingelogd
        return await saveActivityToLocalDB({ fileBlob, fileName, summary })
    }
}

async function listActivities() {
    console.log('📋 Lijst activiteiten op...')
    
    if (currentUser) {
        // Gebruik Supabase als ingelogd
        return await listActivitiesFromSupabase()
    } else {
        // Gebruik lokale IndexedDB als niet ingelogd
        return await listActivitiesFromLocalDB()
    }
}

async function deleteActivity(id) {
    console.log('🗑️ Verwijder activiteit:', id)
    
    if (currentUser) {
        // Gebruik Supabase als ingelogd
        return await deleteActivityFromSupabase(id)
    } else {
        // Gebruik lokale IndexedDB als niet ingelogd
        return await deleteActivityFromLocalDB(id)
    }
}

/* ========== LOKALE OPSLAG (IndexedDB) ========== */
const LOCAL_DB_NAME = "stravaLocalDB"
const LOCAL_STORE_NAME = "localActivities"

async function initLocalStorage() {
    console.log('💾 Initialiseer lokale opslag...')
    try {
        const activities = await listActivitiesFromLocalDB()
        await updateActivitiesUI(activities)
    } catch (error) {
        console.error('❌ Fout bij initialiseren lokale opslag:', error)
    }
}

async function openLocalDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(LOCAL_DB_NAME, 1)
        req.onupgradeneeded = (event) => {
            const db = req.result
            if (!db.objectStoreNames.contains(LOCAL_STORE_NAME)) {
                const store = db.createObjectStore(LOCAL_STORE_NAME, { keyPath: "id" })
                store.createIndex("byDate", "createdAt")
            }
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
    })
}

async function saveActivityToLocalDB({ fileBlob, fileName, summary }) {
    const db = await openLocalDB()
    return new Promise((resolve, reject) => {
        const tx = db.transaction(LOCAL_STORE_NAME, "readwrite")
        const store = tx.objectStore(LOCAL_STORE_NAME)
        
        const item = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            fileName: fileName,
            fileBlob: fileBlob,
            summary: summary,
            createdAt: new Date().toISOString()
        }
        
        const req = store.add(item)
        req.onsuccess = () => resolve(item)
        req.onerror = () => reject(req.error)
    })
}

async function listActivitiesFromLocalDB() {
    const db = await openLocalDB()
    return new Promise((resolve, reject) => {
        const tx = db.transaction(LOCAL_STORE_NAME, "readonly")
        const store = tx.objectStore(LOCAL_STORE_NAME)
        const req = store.getAll()
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
    })
}

async function deleteActivityFromLocalDB(id) {
    const db = await openLocalDB()
    return new Promise((resolve, reject) => {
        const tx = db.transaction(LOCAL_STORE_NAME, "readwrite")
        const store = tx.objectStore(LOCAL_STORE_NAME)
        const req = store.delete(id)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
    })
}

/* ========== UI UPDATE FUNCTIES ========== */
async function updateActivitiesUI(activities) {
    console.log('🎨 Update UI met activiteiten:', activities.length)
    
    // Update de saved activities lijst
    if (typeof renderSavedList === 'function') {
        await renderSavedList()
    }
    
    // Update statistieken
    if (typeof updateStatistics === 'function') {
        await updateStatistics()
    }
    
    // Update rankings
    if (typeof initRankings === 'function') {
        // Forceer refresh van rankings
        allSegmentsCache = null
    }
}

/* ========== EVENT LISTENERS ========== */
function setupAuthEventListeners() {
    console.log('🎯 Setup auth event listeners')
    
    // Login knop
    document.getElementById('loginBtn').addEventListener('click', async () => {
        const email = document.getElementById('loginEmail').value
        const password = document.getElementById('loginPassword').value
        
        if (!email || !password) {
            showNotification('❌ Vul email en wachtwoord in', 'error')
            return
        }
        
        await loginUser(email, password)
    })
    
    // Register knop
    document.getElementById('registerBtn').addEventListener('click', async () => {
        const email = document.getElementById('registerEmail').value
        const password = document.getElementById('registerPassword').value
        
        if (!email || !password) {
            showNotification('❌ Vul email en wachtwoord in', 'error')
            return
        }
        
        await registerUser(email, password)
    })
    
    // Logout knop
    document.getElementById('logoutBtn').addEventListener('click', logoutUser)
    
    // Close modal knop
    document.querySelector('.close-modal').addEventListener('click', hideAuthModal)
    
    // Tab switching
    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            const tabName = e.target.getAttribute('data-tab')
            if (tabName === 'login') {
                switchToLoginTab()
            } else {
                switchToRegisterTab()
            }
        })
    })
    
    // Enter to submit forms
    document.getElementById('loginPassword').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('loginBtn').click()
        }
    })
    
    document.getElementById('registerPassword').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('registerBtn').click()
        }
    })
    
    // Click outside modal to close
    document.getElementById('authModal').addEventListener('click', (e) => {
        if (e.target.id === 'authModal') {
            hideAuthModal()
        }
    })
}

/* ========== INITIALISATIE ========== */
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 DOM geladen, start authenticatie...')
    
    // Setup event listeners
    setupAuthEventListeners()
    
    // Initialiseer authenticatie
    setTimeout(() => {
        initAuth()
    }, 100)
})

/* ========== GLOBALE FUNCTIES ========== */
// Maak functies globaal beschikbaar voor andere scripts
window.supabaseAuth = {
    initAuth,
    loginUser,
    registerUser,
    logoutUser,
    saveActivity,
    listActivities,
    deleteActivity,
    getCurrentUser: () => currentUser,
    isLoggedIn: () => !!currentUser
}

console.log('✅ auth.js geladen en klaar voor gebruik')

