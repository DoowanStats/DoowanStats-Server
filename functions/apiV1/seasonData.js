/*  Declaring npm modules */
const redis = require('redis');

/*  Import dependency modules */
import {
  filterName,
  getProfileHashId,
  getTeamHashId,
  GLOBAL_CONSTS,
} from './dependencies/global';
import {
  dynamoDbGetItem,
  dynamoDbPutItem,
  dynamoDbScanTable,
  dynamoDbUpdateItem,
} from './dependencies/dynamoDbHelper';
import { CACHE_KEYS } from './dependencies/cacheKeys'

/*  Import data functions */
import { getTournamentShortName } from './tournamentData';
import { getProfileName } from './profileData';
import { getTeamName } from './teamData';
import {
  createTournamentId,
  generateTournamentCodes
} from './dependencies/awsLambdaHelper';
import { DYNAMODB_TABLENAMES } from '../../services/constants';
import { getDdragonVersion } from '../../services/miscDynamoDb';

const cache = (process.env.NODE_ENV === 'production') ? redis.createClient(process.env.REDIS_URL) : redis.createClient(process.env.REDIS_PORT);

/**
 * Get SeasonPId from DynamoDb
 * @param {string} shortName    Season shortName (i.e. 'w2020pl')
 */
export const getSeasonId = (shortName) => {
  const simpleName = filterName(shortName);
  const cacheKey = `${CACHE_KEYS.SEASON_ID_PREFIX}${simpleName}`;
  return new Promise(function (resolve, reject) {
    cache.get(cacheKey, (err, data) => {
      if (err) { reject(err); return; }
      else if (data) { resolve(parseInt(data)); return; } // NOTE: Needs to be number
      dynamoDbScanTable(DYNAMODB_TABLENAMES.SEASON, ['SeasonPId'], 'SeasonShortName', simpleName)
        .then((obj) => {
          if (obj.length === 0) { resolve(null); return; } // Not Found
          const Id = obj[0]['SeasonPId'];
          cache.set(cacheKey, Id);
          resolve(Id);
        }).catch((error) => { console.error(error); reject(error) });
    });
  });
}

/**
 * Get ShortName of a Season Id from DynamoDb. Returns a string (i.e. "f2019pl")
 * @param {number} seasonId      Season Id in number format
 */
export const getSeasonShortName = (seasonId) => {
  const cacheKey = CACHE_KEYS.SEASON_CODE_PREFIX + seasonId;
  return new Promise(function (resolve, reject) {
    cache.get(cacheKey, (err, data) => {
      if (err) { reject(err); return; }
      else if (data) { resolve(data); return; }
      dynamoDbGetItem(DYNAMODB_TABLENAMES.SEASON, seasonId)
        .then((obj) => {
          const shortName = obj['SeasonShortName'];
          if (!shortName) { resolve(null); return; } // Not Found
          cache.set(cacheKey, shortName);
          resolve(shortName);
        }).catch((error) => { console.error(error); reject(error) });
    });
  });
}

/**
 * Get SeasonName of a Season Id from DynamoDb. Returns a string (i.e. "Fall 2019 Premier League")
 * @param {number} seasonId      Season Id in number format
 */
export const getSeasonName = (seasonId) => {
  const cacheKey = CACHE_KEYS.SEASON_NAME_PREFIX + seasonId;
  return new Promise(function (resolve, reject) {
    cache.get(cacheKey, (err, data) => {
      if (err) { reject(err); return; }
      else if (data) { resolve(data); return; }
      dynamoDbGetItem(DYNAMODB_TABLENAMES.SEASON, seasonId)
        .then((obj) => {
          if (!obj) { resolve(null); return; } // Not Found
          const name = obj['Information']['SeasonName'];
          cache.set(cacheKey, name);
          resolve(name);
        }).catch((error) => { console.error(error); reject(error) });
    });
  });
}

/**
 * Returns a Season Time (i.e. Winter 2020)
 * @param {number} seasonId 
 */
export const getSeasonTime = (seasonId) => {
  const cacheKey = CACHE_KEYS.SEASON_TIME_PREFIX + seasonId;
  return new Promise(function (resolve, reject) {
    cache.get(cacheKey, (err, data) => {
      if (err) { reject(err); return; }
      else if (data) { resolve(data); return; }
      dynamoDbGetItem(DYNAMODB_TABLENAMES.SEASON, seasonId)
        .then((obj) => {
          if (!obj) { resolve(null); return; } // Not Found
          const time = obj['Information']['SeasonTime'];
          cache.set(cacheKey, time);
          resolve(time);
        }).catch((error) => { console.error(error); reject(error) });
    });
  });
}

/**
 * Returns a Tab Label based on Season Time
 * @param {number} seasonId 
 */
export const getSeasonTabName = (seasonId) => {
  const cacheKey = CACHE_KEYS.SEASON_TAB_PREFIX + seasonId;
  return new Promise(function (resolve, reject) {
    cache.get(cacheKey, (err, data) => {
      if (err) { reject(err); return; }
      else if (data) { resolve(data); return; }
      dynamoDbGetItem(DYNAMODB_TABLENAMES.SEASON, seasonId)
        .then((obj) => {
          if (!obj) { resolve(null); return; } // Not Found
          const tabName = obj['Information']['SeasonTabName'];
          cache.set(cacheKey, tabName);
          resolve(tabName);
        }).catch((error) => { console.error(error); reject(error) });
    });
  });
}

/**
 * For Leagues table component
 */
export const getLeagues = () => {
  return new Promise(function (resolve, reject) {
    cache.get(CACHE_KEYS.LEAGUE_KEY, async (err, data) => {
      if (err) { reject(err); return; }
      else if (data) { resolve(JSON.parse(data)); return; }
      try {
        const seasonList = await dynamoDbScanTable(DYNAMODB_TABLENAMES.SEASON, ['Information']);
        if (seasonList) {
          const leagueObject = {};
          seasonList.map((seasonInfoObject) => {
            const { SeasonTime, DateOpened, LeagueCode, LeagueRank, LeagueType, SeasonShortName } = seasonInfoObject.Information;
            if (!(SeasonTime in leagueObject)) {
              leagueObject[SeasonTime] = {
                'SeasonTime': SeasonTime,
                'Date': DateOpened
              };
            }
            if (!(LeagueRank in leagueObject[SeasonTime])) {
              leagueObject[SeasonTime][LeagueRank] = [];
            }
            leagueObject[SeasonTime][LeagueRank].push({
              'LeagueType': LeagueType,
              'LeagueCode': LeagueCode,
              'LeagueRank': LeagueRank,
              'ShortName': SeasonShortName,
            });
          });
          const returnObject = {};
          returnObject['Leagues'] = Object.values(leagueObject).sort((a, b) => (a.Date < b.Date) ? 1 : -1);
          cache.set(CACHE_KEYS.LEAGUE_KEY, JSON.stringify(returnObject, null, 2), 'EX', GLOBAL_CONSTS.TTL_DURATION);
          resolve(returnObject);
        }
        else {
          resolve(null);   // Return empty if does not exist
        }
      }
      catch (err) { reject(err); }
    });
  })
}

/**
 * Get 'Information' property from Season
 * @param {number} seasonId 
 */
export const getSeasonInformation = (seasonId) => {
  const cacheKey = CACHE_KEYS.SEASON_INFO_PREFIX + seasonId;
  return new Promise(function (resolve, reject) {
    cache.get(cacheKey, async (err, data) => {
      if (err) { reject(err); return; }
      else if (data) { resolve(JSON.parse(data)); return; }
      try {
        const seasonInfoJson = (await dynamoDbGetItem(DYNAMODB_TABLENAMES.SEASON, seasonId))['Information'];
        if (seasonInfoJson) {
          if (seasonInfoJson['TournamentPIds']['RegTournamentPId']) {
            seasonInfoJson['TournamentPIds']['RegTournamentShortName'] = await getTournamentShortName(seasonInfoJson['TournamentPIds']['RegTournamentPId']);
          }
          if (seasonInfoJson['TournamentPIds']['PostTournamentPId']) {
            seasonInfoJson['TournamentPIds']['PostTournamentShortName'] = await getTournamentShortName(seasonInfoJson['TournamentPIds']['PostTournamentPId']);
          }
          if ('FinalStandings' in seasonInfoJson) {
            for (const teamObject of seasonInfoJson['FinalStandings']) {
              teamObject['TeamName'] = await getTeamName(teamObject['TeamHId']);
            }
          }
          if ('FinalsMvpHId' in seasonInfoJson) {
            seasonInfoJson['FinalsMvpName'] = await getProfileName(seasonInfoJson['FinalsMvpHId']);
          }
          if ('AllStars' in seasonInfoJson) {
            seasonInfoJson['AllStars']['TopName'] = await getProfileName(seasonInfoJson['AllStars']['TopHId']);
            seasonInfoJson['AllStars']['JungleName'] = await getProfileName(seasonInfoJson['AllStars']['JungleHId']);
            seasonInfoJson['AllStars']['MidName'] = await getProfileName(seasonInfoJson['AllStars']['MidHId']);
            seasonInfoJson['AllStars']['BotName'] = await getProfileName(seasonInfoJson['AllStars']['BotHId']);
            seasonInfoJson['AllStars']['SupportName'] = await getProfileName(seasonInfoJson['AllStars']['SupportHId']);
          }
          cache.set(cacheKey, JSON.stringify(seasonInfoJson, null, 2), 'EX', GLOBAL_CONSTS.TTL_DURATION);
          resolve(seasonInfoJson);
        }
        else {
          resolve(null);    // If 'Information' does not exist
        }
      }
      catch (error) { reject(error); }
    });
  });
}

/**
 * Get 'Roster' property from Season and properties by HashId
 * @param {number} seasonId 
 */
export const getSeasonRosterById = (seasonId) => {
  const cacheKey = CACHE_KEYS.SEASON_ROSTER_PREFIX + seasonId;
  return new Promise(function (resolve, reject) {
    cache.get(cacheKey, async (err, data) => {
      if (err) { reject(err); return; }
      else if (data) { resolve(JSON.parse(data)); return; }
      dynamoDbGetItem(DYNAMODB_TABLENAMES.SEASON, seasonId).then(async (seasonJson) => {
        if (!seasonJson) { resolve(null); return; }
        const seasonRosterJson = seasonJson['Roster'];
        if (seasonRosterJson) {
          if ('Teams' in seasonRosterJson) {
            for (const teamHId in seasonRosterJson['Teams']) {
              const teamJson = seasonRosterJson['Teams'][teamHId];
              teamJson['TeamName'] = await getTeamName(teamHId);
              teamJson['TeamHId'] = teamHId;
              for (const profileHId in teamJson['Players']) {
                const playerJson = teamJson['Players'][profileHId];
                playerJson['ProfileName'] = await getProfileName(profileHId);
                playerJson['ProfileHId'] = profileHId;
              }
            }
          }
          cache.set(cacheKey, JSON.stringify(seasonRosterJson, null, 2), 'EX', GLOBAL_CONSTS.TTL_DURATION);
          resolve(seasonRosterJson);
        }
        else {
          resolve(null);    // If 'Roster' does not exist
        }
      }).catch((error) => { reject(error); });
    });
    
  });
}

/**
 * Get 'Roster' property from Season and properties are the Team Names / Profile Names
 * @param {number} seasonId 
 */
export const getSeasonRosterByName = (seasonId) => {
  return new Promise((resolve, reject) => {
    getSeasonRosterById(seasonId).then((seasonRosterObject) => {
      if (!seasonRosterObject) { resolve(null); return; }
      // https://stackoverflow.com/questions/8483425/change-property-name
      const teamsRosterObject = seasonRosterObject.Teams;
      for (const teamHId in teamsRosterObject) {
        const teamObject = teamsRosterObject[teamHId]
        const playersRosterObject = teamsRosterObject[teamHId].Players;
        for (const profileHId in playersRosterObject) {
          const profileObject = playersRosterObject[profileHId];
          const profileName = profileObject.ProfileName;
          playersRosterObject[profileName] = profileObject;
          delete playersRosterObject[profileHId];
        }
        const teamName = teamObject.TeamName;
        teamsRosterObject[teamName] = teamObject;
        delete teamsRosterObject[teamHId];
      }
      resolve(seasonRosterObject);
    }).catch((error) => { reject(error); });
  });
}

/**
 * Get 'Regular' property from Season for the Regular Season
 * @param {number} seasonId 
 */
export const getSeasonRegular = (seasonId) => {
  const cacheKey = CACHE_KEYS.SEASON_REGULAR_PREFIX + seasonId;
  return new Promise(function (resolve, reject) {
    cache.get(cacheKey, async (err, data) => {
      if (err) { reject(err); return; }
      else if (data) { resolve(JSON.parse(data)); return; }
      try {
        const seasonRegularJson = (await dynamoDbGetItem(DYNAMODB_TABLENAMES.SEASON, seasonId))['Regular'];
        if (seasonRegularJson != null) {
          for (const divisionJson of seasonRegularJson['RegularSeasonDivisions']) {
            for (const teamJson of divisionJson['RegularSeasonTeams']) {
              teamJson['TeamName'] = await getTeamName(teamJson['TeamHId']);
            }
          }
          for (const gameJson of seasonRegularJson['RegularSeasonGames']) {
            gameJson['BlueTeamName'] = await getTeamName(gameJson['BlueTeamHId']);
            gameJson['RedTeamName'] = await getTeamName(gameJson['RedTeamHid']);
            gameJson['ModeratorName'] = await getProfileName(gameJson['ModeratorHId']);
            gameJson['MvpName'] = await getProfileName(gameJson['MvpHId']);
          }
          cache.set(cacheKey, JSON.stringify(seasonRegularJson, null, 2), 'EX', GLOBAL_CONSTS.TTL_DURATION);
          resolve(seasonRegularJson);
        }
        else {
          resolve(null);    // If DYNAMODB_TABLENAMES.SEASON does not exist
        }
      }
      catch (error) { reject(error); }
    });
  });
}

/**
 * Get 'Playoffs' property from Season for Playoffs
 * @param {number} seasonId 
 */
export const getSeasonPlayoffs = (seasonId) => {
  const cacheKey = CACHE_KEYS.SEASON_PLAYOFF_PREFIX + seasonId;
  return new Promise(function (resolve, reject) {
    cache.get(cacheKey, async (err, data) => {
      if (err) { reject(err); return }
      else if (data != null) { resolve(JSON.parse(data)); return }
      try {
        let playoffJson = (await dynamoDbGetItem(DYNAMODB_TABLENAMES.SEASON, seasonId))['Playoffs'];
        if (playoffJson != null) {
          for (const roundTypeArray of Object.values(playoffJson['PlayoffBracket'])) {
            for (const seriesJson of roundTypeArray) {
              seriesJson['HigherTeamName'] = await getProfileName(seriesJson['HigherTeamHId']);
              seriesJson['LowerTeamName'] = await getProfileName(seriesJson['LowerTeamHId']);
              seriesJson['SeriesMvpName'] = await getProfileName(seriesJson['SeriesMvpHId']);
            }
          }
          for (const gameJson of playoffJson['PlayoffGames']) {
            gameJson['BlueTeamName'] = await getTeamName(gameJson['BlueTeamHId']);
            gameJson['RedTeamName'] = await getTeamName(gameJson['RedTeamHId']);
            gameJson['ModeratorName'] = await getProfileName(gameJson['ModeratorHId']);
            gameJson['MvpName'] = await getProfileName(gameJson['MvpHId']);
          }
          cache.set(cacheKey, JSON.stringify(playoffJson, null, 2), 'EX', GLOBAL_CONSTS.TTL_DURATION);
          resolve(playoffJson);
        }
        else {
          resolve(null);    // If 'Playoffs' does not exist
        }
      }
      catch (error) { reject(error); }
    });
  });
}

/**
 * Gets most recent teamHId of the profileHId
 * @param {number} seasonId 
 * @param {string} profileHId 
 * @return {string} teamHId or 'null' 
 */
export const getMostRecentTeam = (seasonId, profileHId) => {
  return new Promise(async (resolve, reject) => {
    try {
      if (!profileHId) { resolve(null); }
      const seasonRosterJson = await getSeasonRosterById(seasonId);
      resolve(seasonRosterJson?.Profiles?.[profileHId]?.MostRecentTeamHId);
    }
    catch (err) {
      console.error(err);
      reject(err);
    }
  });
}

/**
 * Creates the following:
 * - A new Season item in DynamoDb 
 * - Two tournament items in DynamoDb
 * - A tournament Id through Riot's Tournament API
 * @param {object} body
 * @param {string} body.seasonName  (i.e. "Summer 2021 Aegis Guardians League")
 * @param {string} body.seasonShortName (i.e. "s2021agl")
 * @param {string} body.leagueCode  ("AVL", "ADL", "APL", "AGL")
 * @param {string} body.leagueRank  ("Uncapped", "Diamond", "Platinum", "Gold")
 * @returns 
 */
export const createNewSeason = (body) => {
  const { seasonName, seasonShortName, leagueCode, leagueRank } = body;
  return new Promise(async (resolve, reject) => {
    try {
      const split = seasonName.split(' ');
      if (split.length !== 5) { reject(`'${seasonName}' does not have proper length of 5.`); return; }
      // split[0] Season    ('Summer')
      // split[1] Year      ('2021')
      // split[2] "Aegis"   ('Aegis')
      // split[3] Type      ('Guardians')
      // split[4] "League"  ('League')
      const tabName = `${split[0]} ${split[1]} ${split[3]}`;
      const seasonTime = `${split[0]} ${split[1]}`;
      const leagueType = `${split[3]}`;

      // Create new Tournament in the Riot Tournament API through AWS Lambda
      const riotTournamentId = await createTournamentId(seasonShortName);

      // Create new DynamoDb SeasonId by grabbing the max value and +1
      const seasonList = await dynamoDbScanTable(DYNAMODB_TABLENAMES.SEASON, ['SeasonPId']);
      const maxSeasonId = Math.max.apply(Math, seasonList.map((obj) => { return obj.SeasonPId; }));
      const newSeasonId = maxSeasonId + 1;

      // Create 2 new DynamoDb TournamentIds by grabbing the max value and +1,+2
      const tournamentList = await dynamoDbScanTable(DYNAMODB_TABLENAMES.TOURNAMENT, ['TournamentPId']);
      const maxTournamentId = Math.max.apply(Math, tournamentList.map((obj) => { return obj.TournamentPId; }));
      const newTournamentIds = [ maxTournamentId + 1, maxTournamentId + 2 ];

      // const mostRecentPatch = (ddragonVersion) => {
      //   const versions = ddragonVersion.split('.');
      //   return `${versions[0]}.${versions[1]}`;
      // }
      for (const [idx, newId] of newTournamentIds.entries()) {
        const tournamentShortName = `${seasonShortName}${(idx == 0) ? 'reg' : 'post'}`;
        const newTournamentInformation = {
          TournamentName: `${seasonName} ${(idx == 0) ? 'Regular Season' : 'Playoffs'}`,
          TournamentType: (idx == 0) ? 'Regular' : 'Playoffs',
          TournamentShortName: tournamentShortName,
          TournamentTabName: `${seasonTime} ${(idx == 0) ? 'Regular' : 'Playoffs'}`,
          SeasonPId: newSeasonId,
        };
        const newTournamentItem = {
          TournamentPId: newId,
          TournamentShortName: tournamentShortName,
          Information: newTournamentInformation,
        };
        await dynamoDbPutItem(DYNAMODB_TABLENAMES.TOURNAMENT, newTournamentItem, newId);
      }

      const newSeasonInformation = {
        Status: "Open",
        DateOpened: Math.ceil(Date.now() / 1000),
        SeasonTabName: tabName,
        Description: "Description here.",
        LeagueRank: leagueRank,
        SeasonName: seasonName,
        LeagueType: leagueType,
        SeasonShortName: seasonShortName,
        LeagueCode: leagueCode,
        TournamentPIds: {
          RegTournamentPId: newTournamentIds[0],
          PostTournamentPId: newTournamentIds[1],
        },
        SeasonTime: seasonTime,
      };
      const newSeasonItem = {
        SeasonPId: newSeasonId,
        Information: newSeasonInformation,
        SeasonShortName: seasonShortName,
        Codes: {
          RiotTournamentId: riotTournamentId,
          Weeks: {},
        },
        Roster: {
          Teams: {},
          Profiles: {},
        }
      };
      await dynamoDbPutItem(DYNAMODB_TABLENAMES.SEASON, newSeasonItem, newSeasonId);

      resolve(newSeasonItem);
    }
    catch (err) {
      reject(err);
    }
  });
}

/**
 * Generates new codes under a NEW week
 * @param {number} seasonId         
 * @param {string} week             ("W1", "W2", etc., "PI1", "PI2", etc., "RO16", "QF", "SF", "F")
 * @param {string[]} teamList         List of teams that are matched up. Length must be even.
 * @returns 
 */
export const generateNewCodes = (seasonId, week, teamList) => {
  return new Promise((resolve, reject) => {
    dynamoDbGetItem(DYNAMODB_TABLENAMES.SEASON, seasonId).then(async (seasonObject) => {
      try {
        const weekUppercase = week.toUpperCase();
        const seasonShortName = seasonObject.SeasonShortName;
        const riotTournamentId = seasonObject.Codes?.RiotTournamentId;
        const seasonCodesWeeks = seasonObject.Codes?.Weeks;
        // Check for "Codes" property on seasonObject
        if (!seasonCodesWeeks) {
          reject(`Season '${seasonId}' does not have a "Codes.Weeks" property.`); 
          return;
        }
        // Check for TeamList length
        const filteredTeamList = teamList.filter(team => team.length !== 0);
        if (filteredTeamList.length % 2 > 0) {
          reject(`Team List provided does not have an even amount of teams (Length: ${filteredTeamList.length}).`); 
          return;
        }

        let timesRetried = 0;
        if (!seasonCodesWeeks[weekUppercase]) {
          // Make new property
          seasonCodesWeeks[weekUppercase] = {
            Timestamp: Math.ceil(Date.now() / 1000),
            Primary: [],
            Backups: [],
          }
          // Create Backups
          const awsResponse = await generateTournamentCodes(weekUppercase, 
            riotTournamentId, seasonShortName, null, null, 10);
          seasonCodesWeeks[weekUppercase].Backups = awsResponse.data;
          timesRetried += awsResponse.timedOut;
        }
        const primaryCodesList = seasonCodesWeeks[weekUppercase].Primary;
        for (let i = 0; i < filteredTeamList.length; i++) {
          const teamName1 = filteredTeamList[i];
          const teamName2 = filteredTeamList[++i];
          const awsResponse = await generateTournamentCodes(weekUppercase, 
            riotTournamentId, seasonShortName, teamName1, teamName2);
          const codesList = awsResponse.data;
          timesRetried += awsResponse.timedOut;
          primaryCodesList.push({
            Team1: teamName1,
            Team2: teamName2,
            Codes: codesList,
          });
        }

        await dynamoDbUpdateItem(DYNAMODB_TABLENAMES.SEASON, seasonId,
          'SET #codes.#weeks = :obj',
          {
            '#codes': 'Codes',
            '#weeks': 'Weeks',
          },
          {
            ':obj': seasonCodesWeeks,
          }
        );

        resolve({
          response: `Season '${seasonShortName}' successfully generated new codes.`,
          numMatches: filteredTeamList.length / 2,
          timesRetried,
        });
      }
      catch (err) { 
        reject(err);
      }
    }).catch((err) => { reject(err); });
  });
}

/**
 * Adds new team into Season Roster. Initializes a new object if null
 * @param {number} seasonId     Assume valid
 * @param {array} teamPIdList   Assume valid
 */
export const putSeasonRosterTeams = (seasonId, teamPIdList) => {
  return new Promise((resolve, reject) => {
    dynamoDbGetItem(DYNAMODB_TABLENAMES.SEASON, seasonId).then(async (seasonObject) => {
      const errorList = [];
      const seasonRosterObject = seasonObject.Roster;

      // Check if there is a duplicate
      for (const teamPId of teamPIdList) {
        const teamHId = getTeamHashId(teamPId);
        if (teamHId in seasonRosterObject.Teams) {
          const teamName = await getTeamName(teamHId);
          errorList.push(`${teamName} - Team already in the season Roster.`);
        }
        else {
          seasonRosterObject.Teams[teamHId] = {
            Players: {}
          };
        }
      }

      if (errorList.length > 0) {
        resolve({ errorList: errorList });
      }
      else {
        // Remove cache
        cache.del(`${CACHE_KEYS.SEASON_ROSTER_PREFIX}${seasonId}`);

        await dynamoDbPutItem(DYNAMODB_TABLENAMES.SEASON, seasonObject, seasonId);
        resolve({
          'SeasonId': seasonId,
          'SeasonRoster': seasonRosterObject,
        });
      }
    }).catch((err) => { reject(err); });
  });
}

/**
 * Adds new Profiles into a team in the Season Roster.
 * @param {number} seasonId         Assume valid 
 * @param {string} teamPId          Assume valid
 * @param {string} profilePIdList   Assume valid
 */
export const addProfilesToRoster = (seasonId, teamPId, profilePIdList) => {
  return new Promise((resolve, reject) => {
    dynamoDbGetItem(DYNAMODB_TABLENAMES.SEASON, seasonId).then(async (seasonDbObject) => {
      const errorList = [];

      // Update "Teams" and "Profiles" key
      const rosterTeamDbObject = seasonDbObject.Roster.Teams;
      const rosterProfilesDbObject = seasonDbObject.Roster.Profiles;
      const teamHId = getTeamHashId(teamPId);
      const teamName = await getTeamName(teamHId);
      if (!(teamHId in rosterTeamDbObject)) {
        resolve({ errorList: `${teamName} - Team is not in the Season Roster` });
        return;
      }
      // Check for duplicate in ProfilePId
      const rosterPlayersDbObject = rosterTeamDbObject[teamHId].Players;
      const profileMessages = [];
      for (const profilePId of profilePIdList) {
        const profileHId = getProfileHashId(profilePId);
        const profileName = await getProfileName(profileHId);
        if (rosterPlayersDbObject && profileHId in rosterPlayersDbObject) {
          // Duplicate found
          profileMessages.push(`${profileName} - Profile is already in the Team.`);
        } else {
          // Create new object
          rosterPlayersDbObject[profileHId] = {};
          rosterProfilesDbObject[profileHId] = { MostRecentTeamHId: teamHId }
          profileMessages.push(`${profileName} - Profile added to the Team.`);
        }
      }

      if (errorList.length > 0) {
        resolve({ errorList: errorList });
      }
      else {
        // Remove cache
        cache.del(`${CACHE_KEYS.SEASON_ROSTER_PREFIX}${seasonId}`);

        await dynamoDbPutItem(DYNAMODB_TABLENAMES.SEASON, seasonDbObject, seasonId);
        resolve({
          'SeasonId': seasonId,
          'TeamName': teamName,
          'Profiles': profileMessages,
          'SeasonRoster': { [teamHId]: rosterPlayersDbObject },
        });
      }
    }).catch((err) => { reject(err); });
  });
}

/**
 * Remove Profile from Season's roster. Assume inputs are valid.
 * @param {number} seasonId         Assume valid
 * @param {string} teamPId          Assume valid
 * @param {array} profilePIdList    Assume valid
 */
export const removeProfileFromRoster = (seasonId, teamPId, profilePIdList) => {
  return new Promise((resolve, reject) => {
    dynamoDbGetItem(DYNAMODB_TABLENAMES.SEASON, seasonId).then(async (seasonDbObject) => {
      if (!('Roster' in seasonDbObject) || !('Teams' in seasonDbObject.Roster)) {
        resolve({ error: `Season Object does not have Roster.` });
        return;
      }
      const rosterTeamDbObject = seasonDbObject.Roster.Teams;
      const teamHId = getTeamHashId(teamPId);
      const teamName = await getTeamName(teamHId);
      if (!(teamHId in rosterTeamDbObject)) {
        resolve({ error: `${teamName} - Team is not in the Season Roster` });
        return;
      }

      const rosterPlayersDbObject = rosterTeamDbObject[teamHId].Players;
      const profileMessages = [];
      for (const profilePId of profilePIdList) {
        const profileHId = getProfileHashId(profilePId);
        const profileName = await getProfileName(profileHId);
        if (profileHId in rosterPlayersDbObject) {
          delete rosterPlayersDbObject[profileHId];
          profileMessages.push(`${profileName} - Profile removed from Team`);
        }
        else {
          profileMessages.push(`${profileName} - Profile not found in Team`);
        }
      }

      // Remove cache
      cache.del(`${CACHE_KEYS.SEASON_ROSTER_PREFIX}${seasonId}`);

      await dynamoDbPutItem(DYNAMODB_TABLENAMES.SEASON, seasonDbObject, seasonId);
      resolve({
        'SeasonId': seasonId,
        'TeamName': teamName,
        'Profiles': profileMessages,
        'SeasonRoster': { [teamHId]: rosterPlayersDbObject },
      });

    }).catch((err) => { reject(err); });
  });
}