/**
 * Everyday Tasks Hub - Express Backend Server
 * 
 * This server manages the hub state for users and provides REST API endpoints
 * for both the frontend website and Alexa skill to interact with.
 * 
 * TODO: Replace in-memory storage with a real database (MongoDB, PostgreSQL, etc.)
 */

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());
app.use(cors()); // Open CORS for local development - TODO: Restrict in production

// =============================================================================
// IN-MEMORY DATA STORE
// TODO: Replace this with a real database connection (MongoDB, PostgreSQL, etc.)
// =============================================================================

/**
 * Hub state storage by visitorId (short ID for easier tracking)
 * Structure: { [visitorId]: HubState }
 */
const hubStateByVisitorId = {};

/**
 * Maps Alexa userId to our shorter visitorId
 * Structure: { [alexaUserId]: visitorId }
 */
const alexaUserToVisitor = {};

/**
 * Counter for generating visitor IDs
 */
let visitorCounter = 0;

/**
 * Registered profiles that users have created via Alexa
 * Structure: { [visitorId]: { name, avatar, createdAt, lastSeen } }
 */
const registeredProfiles = {};

/**
 * Predefined tasks for the Everyday Tasks Hub
 */
const DEFAULT_TASKS = [
  { id: 't1', title: 'Morning Routine', icon: '☀️', description: 'Start your day right', category: 'routine', voiceCommand: 'start my morning routine' },
  { id: 't2', title: 'Grocery List', icon: '🛒', description: 'Manage shopping items', category: 'list', voiceCommand: 'open my grocery list' },
  { id: 't3', title: 'Medication Reminder', icon: '💊', description: 'Never miss a dose', category: 'health', voiceCommand: 'set medication reminder' },
  { id: 't4', title: 'Control Lights', icon: '💡', description: 'Smart home controls', category: 'home', voiceCommand: 'turn off the lights' },
  { id: 't5', title: 'Privacy Dashboard', icon: '🛡️', description: 'Manage your data', category: 'privacy', voiceCommand: 'show privacy settings' },
  { id: 't6', title: 'Evening Routine', icon: '🌙', description: 'Wind down for the night', category: 'routine', voiceCommand: 'start evening routine' },
];

/**
 * Gets or creates a visitor ID for an Alexa user
 * @param {string} alexaUserId - The Alexa user ID
 * @returns {string} Visitor ID
 */
function getVisitorId(alexaUserId) {
  // For demo/web users, use the ID directly
  if (!alexaUserId.startsWith('amzn1.')) {
    return alexaUserId;
  }
  
  // For Alexa users, map to a shorter visitor ID
  if (!alexaUserToVisitor[alexaUserId]) {
    visitorCounter++;
    alexaUserToVisitor[alexaUserId] = `alexa-user-${visitorCounter}`;
  }
  return alexaUserToVisitor[alexaUserId];
}

/**
 * Creates a default hub state for a new user
 * @param {string} visitorId - The visitor's unique identifier
 * @returns {Object} Default hub state object
 */
function createDefaultHubState(visitorId) {
  return {
    visitorId: visitorId,
    odisplayName: null, // Set by user via Alexa: "call me Mom"
    activeTile: 'home',
    lastAction: 'NONE',
    profile: 'default',
    routineResult: {
      lights: null,
      thermostat: null,
      reminder: null
    },
    groceryList: [],
    pendingItem: null,
    privacy: {
      microphoneEnabled: true,
      allowVoiceHistory: true,
      lastHistoryDelete: null
    },
    tasks: [...DEFAULT_TASKS], // Copy of default tasks
    customTasks: [], // User-added tasks
    debugInfo: {
      lastUpdated: new Date().toISOString(),
      lastAlexaRequest: null,
      isAlexaUser: visitorId.startsWith('alexa-user-')
    }
  };
}

/**
 * Gets or creates hub state for a visitor
 * @param {string} visitorId - The visitor's unique identifier
 * @returns {Object} The visitor's hub state
 */
function getOrCreateHubState(visitorId) {
  if (!hubStateByVisitorId[visitorId]) {
    hubStateByVisitorId[visitorId] = createDefaultHubState(visitorId);
    console.log(`[Hub] Created new hub state for visitor: ${visitorId}`);
  }
  return hubStateByVisitorId[visitorId];
}

/**
 * Deep merges partial state into existing state
 */
function deepMerge(target, source) {
  const result = { ...target };
  
  for (const key in source) {
    if (source[key] !== undefined) {
      if (
        source[key] !== null &&
        typeof source[key] === 'object' &&
        !Array.isArray(source[key]) &&
        target[key] !== null &&
        typeof target[key] === 'object' &&
        !Array.isArray(target[key])
      ) {
        result[key] = deepMerge(target[key], source[key]);
      } else {
        result[key] = source[key];
      }
    }
  }
  
  return result;
}

// =============================================================================
// REST API ROUTES
// =============================================================================

/**
 * POST /hub/state
 * Purpose: Called by Alexa Lambda (or simulator) to update the hub state
 * 
 * Request Body:
 * {
 *   "userId": "string",      // Can be Alexa userId or simple visitorId
 *   "state": { ... },        // Partial state to merge
 *   "displayName": "string"  // Optional: Name to show in UI (e.g., "Mom")
 * }
 */
app.post('/hub/state', (req, res) => {
  try {
    const { userId, state, displayName } = req.body;

    if (!userId) {
      return res.status(400).json({ 
        ok: false, 
        error: 'userId is required' 
      });
    }

    // Convert Alexa userId to our visitorId
    const visitorId = getVisitorId(userId);

    // Get or create existing state
    const existingState = getOrCreateHubState(visitorId);

    // Merge incoming state with existing state
    const updatedState = deepMerge(existingState, state || {});
    
    // Update display name if provided (from "Alexa, call me Mom")
    if (displayName) {
      updatedState.displayName = displayName;
      
      // Register/update the profile
      registeredProfiles[visitorId] = {
        name: displayName,
        avatar: getAvatarForName(displayName),
        createdAt: registeredProfiles[visitorId]?.createdAt || new Date().toISOString(),
        lastSeen: new Date().toISOString()
      };
    }
    
    // Update timestamp and debug info
    updatedState.debugInfo = updatedState.debugInfo || {};
    updatedState.debugInfo.lastUpdated = new Date().toISOString();
    updatedState.debugInfo.isAlexaUser = userId.startsWith('amzn1.');
    updatedState.debugInfo.originalAlexaId = userId.startsWith('amzn1.') ? userId.substring(0, 30) + '...' : null;

    // Store updated state
    hubStateByVisitorId[visitorId] = updatedState;

    // Update last seen for registered profile
    if (registeredProfiles[visitorId]) {
      registeredProfiles[visitorId].lastSeen = new Date().toISOString();
    }

    console.log(`[Hub] Updated state for visitor: ${visitorId}`);
    console.log(`[Hub] Active tile: ${updatedState.activeTile}, Last action: ${updatedState.lastAction}`);

    return res.json({ 
      ok: true, 
      state: updatedState,
      visitorId: visitorId
    });

  } catch (error) {
    console.error('[Hub] Error updating state:', error);
    return res.status(500).json({ 
      ok: false, 
      error: 'Internal server error' 
    });
  }
});

/**
 * GET /hub/state/:userId
 * Purpose: Called by the frontend website to get current hub state
 */
app.get('/hub/state/:userId', (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ 
        ok: false, 
        error: 'userId is required' 
      });
    }

    const visitorId = getVisitorId(userId);
    const hubState = getOrCreateHubState(visitorId);

    console.log(`[Hub] Fetched state for visitor: ${visitorId}`);

    return res.json(hubState);

  } catch (error) {
    console.error('[Hub] Error fetching state:', error);
    return res.status(500).json({ 
      ok: false, 
      error: 'Internal server error' 
    });
  }
});

/**
 * GET /hub/profiles
 * Purpose: Get all registered profiles (users who have used the Alexa skill)
 * This is used by the frontend to show only real users
 */
app.get('/hub/profiles', (req, res) => {
  try {
    const profiles = Object.entries(registeredProfiles).map(([visitorId, profile]) => ({
      visitorId,
      ...profile,
      state: hubStateByVisitorId[visitorId] || null
    }));

    // Sort by last seen (most recent first)
    profiles.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));

    return res.json({
      count: profiles.length,
      profiles: profiles
    });

  } catch (error) {
    console.error('[Hub] Error fetching profiles:', error);
    return res.status(500).json({ 
      ok: false, 
      error: 'Internal server error' 
    });
  }
});

/**
 * POST /hub/profile/register
 * Purpose: Register a new profile (called when user says "Alexa, call me Mom")
 */
app.post('/hub/profile/register', (req, res) => {
  try {
    const { userId, name } = req.body;

    if (!userId || !name) {
      return res.status(400).json({ 
        ok: false, 
        error: 'userId and name are required' 
      });
    }

    const visitorId = getVisitorId(userId);

    registeredProfiles[visitorId] = {
      name: name,
      avatar: getAvatarForName(name),
      createdAt: registeredProfiles[visitorId]?.createdAt || new Date().toISOString(),
      lastSeen: new Date().toISOString()
    };

    // Update the hub state with display name
    const hubState = getOrCreateHubState(visitorId);
    hubState.displayName = name;
    hubState.profile = name.toLowerCase();
    hubStateByVisitorId[visitorId] = hubState;

    console.log(`[Hub] Registered profile: ${name} for visitor: ${visitorId}`);

    return res.json({
      ok: true,
      profile: registeredProfiles[visitorId],
      visitorId: visitorId
    });

  } catch (error) {
    console.error('[Hub] Error registering profile:', error);
    return res.status(500).json({ 
      ok: false, 
      error: 'Internal server error' 
    });
  }
});

/**
 * GET /hub/tasks
 * Purpose: Get the default task definitions for the hub
 */
app.get('/hub/tasks', (req, res) => {
  return res.json({
    tasks: DEFAULT_TASKS
  });
});

/**
 * POST /hub/reset
 * Purpose: Reset state for demo purposes
 */
app.post('/hub/reset', (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ 
        ok: false, 
        error: 'userId is required' 
      });
    }

    const visitorId = getVisitorId(userId);
    const freshState = createDefaultHubState(visitorId);
    hubStateByVisitorId[visitorId] = freshState;

    console.log(`[Hub] Reset state for visitor: ${visitorId}`);

    return res.json({ 
      ok: true, 
      state: freshState 
    });

  } catch (error) {
    console.error('[Hub] Error resetting state:', error);
    return res.status(500).json({ 
      ok: false, 
      error: 'Internal server error' 
    });
  }
});

/**
 * GET /hub/users
 * Purpose: Debug endpoint to see all users
 */
app.get('/hub/users', (req, res) => {
  const visitorIds = Object.keys(hubStateByVisitorId);
  return res.json({ 
    count: visitorIds.length, 
    visitorIds: visitorIds,
    profiles: registeredProfiles,
    alexaMappings: alexaUserToVisitor
  });
});

/**
 * Helper: Get avatar emoji based on name
 */
function getAvatarForName(name) {
  const nameLower = name.toLowerCase();
  if (nameLower.includes('mom') || nameLower.includes('mother') || nameLower.includes('mama')) return '👩';
  if (nameLower.includes('dad') || nameLower.includes('father') || nameLower.includes('papa')) return '👨';
  if (nameLower.includes('kid') || nameLower.includes('child') || nameLower.includes('son')) return '👦';
  if (nameLower.includes('daughter') || nameLower.includes('girl')) return '👧';
  if (nameLower.includes('grandma') || nameLower.includes('grandmother')) return '👵';
  if (nameLower.includes('grandpa') || nameLower.includes('grandfather')) return '👴';
  if (nameLower.includes('student')) return '🧑‍🎓';
  return '👤';
}

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'Everyday Tasks Hub API',
    activeVisitors: Object.keys(hubStateByVisitorId).length,
    registeredProfiles: Object.keys(registeredProfiles).length
  });
});

// =============================================================================
// START SERVER
// =============================================================================

app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('  Everyday Tasks Hub - Backend Server');
  console.log('='.repeat(60));
  console.log(`  Server running on http://localhost:${PORT}`);
  console.log('');
  console.log('  Available endpoints:');
  console.log(`    GET  /health              - Health check`);
  console.log(`    GET  /hub/state/:userId   - Get hub state for user`);
  console.log(`    POST /hub/state           - Update hub state`);
  console.log(`    POST /hub/reset           - Reset user's hub state`);
  console.log(`    GET  /hub/users           - List all users (debug)`);
  console.log('='.repeat(60));
});

module.exports = app; // Export for testing
