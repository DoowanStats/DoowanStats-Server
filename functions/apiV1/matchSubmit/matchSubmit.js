// This function needs its own file because it is massive.

/*  Import dependency modules */
import { createDbMatchV5Object } from './createMatchV5Object';
import { getProfilePIdByName } from '../profileData';
import { getTeamPIdByName } from '../teamData';
import { checkRdsStatus } from '../dependencies/awsRdsHelper';
import { 
  dynamoDbGetItem,
  dynamoDbPutItem
} from '../dependencies/dynamoDbHelper';
import {
  AWS_RDS_STATUS,
  DYNAMODB_TABLENAMES,
  MISC_KEYS,
  TEAM_STRING,
} from '../../../services/constants';
import { mySqlInsertMatch } from './mySqlInsertMatch';
import { getMatchSetupMap } from '../matchData';
import { getChampIdObject } from '../../../services/miscDynamoDb';

/**
 * Takes the Setup of matchId 
 * @param {string} id   matchId
 */
export const submitMatchSetup = (id) => {
  return new Promise(async (resolve, reject) => {
    try {
      const matchDbObject = await dynamoDbGetItem('Matches', id);

      // Check if matchJson exists
      if (!matchDbObject) {
        console.error(`Match ID ${matchId} does not exist.`);
        resolve(null);
        return;
      }
      // Check if there is a Setup property in matchJson
      if (!('Setup' in matchDbObject)) {
        console.error(`Match ID ${matchId} no longer has a Setup.`);
        resolve(null);
        return;
      }

      // Check validateList and resolve with validation errors
      const validateList = await validateSetupFormFields(matchDbObject.Setup.Teams);
      if (validateList.length > 0) {
        resolve({
          error: 'Form fields from Match Setup are not valid.',
          setupObject: matchDbObject.Setup,
          validateMessages: validateList,
        });
        return;
      }

      // Create Db object for databases
      const newMatchDbObject = await createDbMatchV5Object(id, matchDbObject.Setup);

      // Push into MySQL and DynamoDb
      await mySqlInsertMatch(newMatchDbObject, matchDbObject.Setup);
      await dynamoDbPutItem('Matches', newMatchDbObject, id);

      // Delete from MatchSetup list in the Miscellaneous DynamoDb table.
      const setupIdMap = await getMatchSetupMap();
      delete setupIdMap[id];
      const newDbItem = {
        Key: MISC_KEYS.MATCH_SETUP_IDS,
        MatchSetupIdMap: setupIdMap
      };
      await dynamoDbPutItem(DYNAMODB_TABLENAMES.MISCELLANEOUS, newDbItem, MISC_KEYS.MATCH_SETUP_IDS);

      resolve(newMatchDbObject);
    }
    catch (error) {
      reject(error);
    }
  });
}

/**
 * 
 * @param {object} setupTeamsDbObject 
 */
function validateSetupFormFields(setupTeamsDbObject) {
  return new Promise(async (resolve, reject) => {
    try {
      const validateList = [];
      const champObject = await getChampIdObject();

      // Check all the bans that they are actual champIds
      const checkBans = async (color, banList) => {
        const checkDuplicateBanList = [];
        for (const [i, banId] of banList.entries()) {
          if (!(banId in champObject)) {
            validateList.push(
              `${color} Team Bans of Id '${banId}' at index ${i} is invalid.`
            );
          }
          else if (checkDuplicateBanList.includes(banId)) {
            validateList.push(
              `${color} Team Bans of Id '${banId}' is a duplicate in Textfields.`
            );
          }
          else {
            checkDuplicateBanList.push(banId);
          }
        }
      }
      await checkBans(TEAM_STRING.BLUE, setupTeamsDbObject.BlueTeam.Bans);
      await checkBans(TEAM_STRING.RED, setupTeamsDbObject.RedTeam.Bans);

      // Check if all profileNames exist in DynamoDb
      const checkProfiles = async (color, playerList) => {
        const roleList = [];
        const checkDuplicateProfileList = [];
        for (const [i, playerObject] of playerList.entries()) {
          const profilePId = await getProfilePIdByName(playerObject.ProfileName);
          if (!profilePId) {
            validateList.push(
              `${color} Team Profile Name '${playerObject.ProfileName}' does not exist in database.`
            );
          }
          else if (checkDuplicateProfileList.includes(profilePId)) {
            validateList.push(
              `${color} Team Profile Name '${playerObject.ProfileName}' duplicate in Textfields.`
            );
          }
          else {
            checkDuplicateProfileList.push(profilePId);
            setupTeamsDbObject[`${color}Team`].Players[i].ProfilePId = profilePId;
          }

          if (!playerObject.Role) {
            validateList.push(
              `${color} Team has an empty textfield for its Role.`
            )
          }
          else if (roleList.includes(playerObject.Role)) {
            validateList.push(
              `${color} Team duplicate Role '${playerObject.Role}'.`
            );
          }
          else {
            roleList.push(playerObject.Role);
          }
        }
      }
      await checkProfiles(TEAM_STRING.BLUE, setupTeamsDbObject.BlueTeam.Players);
      await checkProfiles(TEAM_STRING.RED, setupTeamsDbObject.RedTeam.Players);

      // Check if both teamNames exist in DynamoDb
      const checkTeamName = async (color, teamName) => {
        const teamPId = await getTeamPIdByName(teamName);
        if (!teamPId) {
          validateList.push(
            `${color} Team Name '${teamName}' does not exist in database.`
          );
        }
        else {
          setupTeamsDbObject[`${color}Team`].TeamPId = teamPId;
        }
      }
      await checkTeamName(TEAM_STRING.BLUE, setupTeamsDbObject.BlueTeam.TeamName);
      await checkTeamName(TEAM_STRING.RED, setupTeamsDbObject.RedTeam.TeamName);

      // Check if team names are the same
      if (setupTeamsDbObject.BlueTeam.TeamName === setupTeamsDbObject.RedTeam.TeamName) {
        validateList.push(`Team Names are the same.`);
      }

      // Check if the MySQL Db is available
      if ((await checkRdsStatus()) !== AWS_RDS_STATUS.AVAILABLE) {
        validateList.push(`MySQL Database is inactive. Start it first.`);
      }

      resolve(validateList);
    }
    catch (err) {
      reject(err);
    }
  })

}