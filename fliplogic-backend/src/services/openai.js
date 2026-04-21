import { OpenAI } from 'openai';
import logger from '../config/logger.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Analyze vehicle photo using OpenAI Vision
 * @param {string} imageUrl - URL of vehicle image
 * @param {string} analysisType - Type of analysis (paint, tires, etc.)
 * @returns {Promise<object>} Analysis result
 */
export async function analyzeVehiclePhoto(imageUrl, analysisType = 'condition') {
  try {
    const prompts = {
      condition: 'Analyze this vehicle photo and provide an overall condition assessment (good, fair, or poor). Look for paint quality, dents, rust, interior condition, and wear.',
      paint: 'Analyze the paint condition in this vehicle photo. Is it in good, fair, or poor condition? Note any scratches, chips, fading, or damage.',
      tires: 'Analyze the tire condition in this vehicle photo. Are the tires in good, fair, or poor condition? Estimate tread depth.',
      interior: 'Analyze the interior condition visible in this vehicle photo. Is the interior in good, fair, or poor condition?',
      glass: 'Analyze the glass condition in this vehicle photo. Are there any chips or cracks? Rate as good, fair, or poor.',
    };

    const prompt = prompts[analysisType] || prompts.condition;

    const response = await openai.chat.completions.create({
      model: 'gpt-4-vision-preview',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: imageUrl },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
      max_tokens: 300,
    });

    const analysis = response.choices[0].message.content;

    logger.info(`✅ Photo analysis complete: ${analysisType}`);

    return {
      analysisType,
      result: analysis,
      confidence: 0.85, // OpenAI doesn't provide confidence, placeholder
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    logger.error('Photo analysis error:', error);
    throw error;
  }
}

/**
 * Analyze with OpenAI for general automotive expertise
 * @param {string} prompt - Analysis prompt
 * @returns {Promise<string>} Analysis result
 */
export async function analyzeWithOpenAI(prompt) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are an expert automotive appraiser and dealer. Provide detailed, practical analysis for vehicle valuation and reconditioning.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: 1000,
      temperature: 0.7,
    });

    const result = response.choices[0].message.content;

    logger.info('✅ OpenAI analysis complete');

    return result;
  } catch (error) {
    logger.error('OpenAI analysis error:', error);
    throw error;
  }
}

/**
 * Generate recon cost estimate using AI
 * @param {object} vehicleData - Vehicle information
 * @param {object} conditionData - Condition assessment
 * @param {string} region - Geographic region
 * @returns {Promise<number>} Estimated recon cost
 */
export async function estimateReconCostWithAI(vehicleData, conditionData, region = 'Canada') {
  try {
    const prompt = `
    You are an expert automotive reconditioning specialist. Based on the following vehicle condition and regional labor costs, estimate the total reconditioning cost.

    Vehicle: ${vehicleData.year} ${vehicleData.make} ${vehicleData.model}
    Region: ${region}
    
    Condition Assessment:
    ${JSON.stringify(conditionData, null, 2)}

    Provide ONLY a single number (the estimated cost in CAD) with no explanation.
    Include: paint touch-ups, detailing, minor repairs, inspection, and certification.
    `;

    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are an expert automotive reconditioning specialist. Always respond with ONLY a number representing the cost estimate in CAD. No explanation needed.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: 50,
      temperature: 0.5,
    });

    const costString = response.choices[0].message.content.trim();
    const cost = parseInt(costString.replace(/[^0-9]/g, ''));

    if (isNaN(cost) || cost < 0) {
      throw new Error('Invalid cost estimate received from AI');
    }

    logger.info(`✅ Recon cost estimated: $${cost}`);

    return cost;
  } catch (error) {
    logger.error('Recon cost estimation error:', error);
    // Return default estimate if AI fails
    return 3000;
  }
}
