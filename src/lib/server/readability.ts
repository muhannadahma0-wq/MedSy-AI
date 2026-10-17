/**
 * Port of server/src/utils/readabilityChecker.js — Flesch-Kincaid Grade Level
 * and Flesch Reading Ease with English and Arabic adaptations.
 */

import { getReadingLevelKey, getReadingLevelLabel } from "./language-config";

interface TextStatistics {
  wordCount: number;
  sentenceCount: number;
  syllableCount: number;
  text: string;
}

export interface ReadabilityResult {
  fleschKincaid: number;
  fleschReadingEase: number;
  readingLevel: string;
  readingLevelLabel: string;
  grade: number;
  isTooComplex: boolean;
  statistics: {
    wordCount: number;
    sentenceCount: number;
    syllableCount: number;
    averageWordsPerSentence: number;
    averageSyllablesPerWord: number;
  };
  recommendations: string[];
}

class ReadabilityChecker {
  complexityThreshold = 12;
  minWordsForAnalysis = 10;

  analyzeReadability(text: string, language = "en"): ReadabilityResult {
    if (!text || text.trim().length === 0) {
      return this.getEmptyResponse();
    }

    const cleanText = this.cleanText(text);
    const stats = this.getTextStatistics(cleanText, language);

    if (stats.wordCount < this.minWordsForAnalysis) {
      return this.getEmptyResponse();
    }

    let scores: { fleschKincaid: number; fleschReadingEase: number };
    switch (language) {
      case "ar":
        scores = this.calculateArabicReadability(stats);
        break;
      case "en":
      default:
        scores = this.calculateEnglishReadability(stats);
    }

    const readingLevelKey = getReadingLevelKey(scores.fleschKincaid);
    const readingLevel = getReadingLevelLabel(scores.fleschKincaid);
    const isTooComplex = scores.fleschKincaid > this.complexityThreshold;
    const recommendations = this.generateRecommendations(scores, stats, isTooComplex);

    return {
      fleschKincaid: Math.round(scores.fleschKincaid * 10) / 10,
      fleschReadingEase: Math.round(scores.fleschReadingEase * 10) / 10,
      readingLevel: readingLevelKey,
      readingLevelLabel: readingLevel,
      grade: Math.round(scores.fleschKincaid),
      isTooComplex,
      statistics: {
        wordCount: stats.wordCount,
        sentenceCount: stats.sentenceCount,
        syllableCount: stats.syllableCount,
        averageWordsPerSentence: Math.round((stats.wordCount / stats.sentenceCount) * 10) / 10,
        averageSyllablesPerWord: Math.round((stats.syllableCount / stats.wordCount) * 10) / 10,
      },
      recommendations,
    };
  }

  private calculateEnglishReadability(stats: TextStatistics) {
    const { wordCount, sentenceCount, syllableCount } = stats;
    if (sentenceCount === 0 || wordCount === 0) {
      return { fleschKincaid: 0, fleschReadingEase: 100 };
    }
    const fleschKincaid = 0.39 * (wordCount / sentenceCount) + 11.8 * (syllableCount / wordCount) - 15.59;
    const fleschReadingEase = 206.835 - 1.015 * (wordCount / sentenceCount) - 84.6 * (syllableCount / wordCount);
    return {
      fleschKincaid: Math.max(0, fleschKincaid),
      fleschReadingEase: Math.min(100, Math.max(0, fleschReadingEase)),
    };
  }

  /**
   * Arabic adaptation — unvocalized MSA has no explicit vowels, so syllables
   * are approximated from word length (≈1 syllable per 2 letters, mirroring
   * the skeleton of the Flesch-Kincaid formula with Arabic-tuned constants).
   */
  private calculateArabicReadability(stats: TextStatistics) {
    const { wordCount, sentenceCount, syllableCount } = stats;
    if (sentenceCount === 0 || wordCount === 0) {
      return { fleschKincaid: 0, fleschReadingEase: 100 };
    }
    const fleschKincaid = 0.5 * (wordCount / sentenceCount) + 8.0 * (syllableCount / wordCount) - 13.0;
    const fleschReadingEase = 200.0 - 1.0 * (wordCount / sentenceCount) - 55.0 * (syllableCount / wordCount);
    return {
      fleschKincaid: Math.max(0, fleschKincaid),
      fleschReadingEase: Math.min(100, Math.max(0, fleschReadingEase)),
    };
  }

  private generateRecommendations(
    scores: { fleschReadingEase: number },
    stats: TextStatistics,
    isTooComplex: boolean
  ): string[] {
    const recommendations: string[] = [];

    if (!isTooComplex) {
      recommendations.push("✓ Text is at appropriate reading level for medical content");
      return recommendations;
    }

    const avgWordsPerSentence = stats.wordCount / stats.sentenceCount;
    const avgSyllablesPerWord = stats.syllableCount / stats.wordCount;

    if (avgWordsPerSentence > 20) {
      recommendations.push(
        "📌 Consider shorter sentences (average: " +
          Math.round(avgWordsPerSentence) +
          " words). Target: 15-18 words per sentence."
      );
    }
    if (avgSyllablesPerWord > 1.8) {
      recommendations.push(
        "📌 Replace longer, technical terms with simpler alternatives (average: " +
          avgSyllablesPerWord.toFixed(1) +
          " syllables per word)."
      );
    }
    if (scores.fleschReadingEase < 30) {
      recommendations.push("📌 Text is very complex. Break down complex ideas into multiple shorter sentences.");
    } else if (scores.fleschReadingEase < 50) {
      recommendations.push("📌 Text is moderately complex. Consider simplifying vocabulary and sentence structure.");
    }
    if (stats.sentenceCount < 3) {
      recommendations.push("📌 Add more sentences to improve readability and break up dense content.");
    }
    recommendations.push("💡 Medical terms are acceptable; focus on sentence clarity and word simplicity.");
    return recommendations;
  }

  private getTextStatistics(text: string, language = "en"): TextStatistics {
    const words = this.extractWords(text);
    const sentences = this.extractSentences(text);
    const syllableCount = this.countSyllables(words, language);
    return {
      wordCount: words.length,
      sentenceCount: Math.max(1, sentences.length),
      syllableCount,
      text,
    };
  }

  private extractWords(text: string): string[] {
    return text.match(/\b[\p{L}\p{N}]+\b/gu) || [];
  }

  private extractSentences(text: string): string[] {
    const sentenceRegex = /[.!؟?]+(?:\s+|$)/g;
    return text.split(sentenceRegex).filter((s) => s.trim().length > 0);
  }

  private countSyllables(words: string[], language = "en"): number {
    let totalSyllables = 0;
    for (const word of words) {
      totalSyllables += this.countWordSyllables(word.toLowerCase(), language);
    }
    return Math.max(totalSyllables, words.length);
  }

  private countWordSyllables(word: string, language = "en"): number {
    switch (language) {
      case "ar":
        return this.countArabicSyllables(word);
      case "en":
      default:
        return this.countEnglishSyllables(word);
    }
  }

  private countEnglishSyllables(word: string): number {
    if (word.length <= 3) return 1;
    let syllableCount = 0;
    let previousWasVowel = false;
    const vowels = "aeiouy";
    for (let i = 0; i < word.length; i++) {
      const isVowel = vowels.includes(word[i]);
      if (isVowel && !previousWasVowel) syllableCount++;
      previousWasVowel = isVowel;
    }
    if (word.endsWith("e")) syllableCount--;
    if (word.endsWith("le") && word.length > 2 && !vowels.includes(word[word.length - 3])) {
      syllableCount++;
    }
    if (word.endsWith("ed") && !vowels.includes(word[word.length - 3])) syllableCount--;
    if (word.endsWith("ous")) syllableCount--;
    return Math.max(1, syllableCount);
  }

  /** Arabic syllable estimate: strip tashkeel, ~1 syllable per 2 letters. */
  private countArabicSyllables(word: string): number {
    const stripped = word.replace(/[\u064B-\u0652\u0670\u0640]/g, "");
    const arabicLetters = (stripped.match(/[\u0621-\u064A]/g) || []).length;
    if (arabicLetters === 0) {
      // Latin/numeric token inside Arabic text → fall back to English counting.
      return this.countEnglishSyllables(word.toLowerCase());
    }
    return Math.max(1, Math.ceil(arabicLetters / 2));
  }

  private cleanText(text: string): string {
    return text
      .replace(/\s+/g, " ")
      .replace(/[^\p{L}\p{N}\s.!?]/gu, "")
      .trim();
  }

  private getEmptyResponse(): ReadabilityResult {
    return {
      fleschKincaid: 0,
      fleschReadingEase: 0,
      readingLevel: "unknown",
      readingLevelLabel: "Unknown",
      grade: 0,
      isTooComplex: false,
      statistics: {
        wordCount: 0,
        sentenceCount: 0,
        syllableCount: 0,
        averageWordsPerSentence: 0,
        averageSyllablesPerWord: 0,
      },
      recommendations: ["Text is too short to analyze."],
    };
  }

  getComplexityAssessment(score: number): string {
    if (score >= 90) return "Very Easy";
    if (score >= 80) return "Easy";
    if (score >= 70) return "Fairly Easy";
    if (score >= 60) return "Standard";
    if (score >= 50) return "Fairly Difficult";
    if (score >= 30) return "Difficult";
    return "Very Difficult";
  }
}

const readabilityChecker = new ReadabilityChecker();
export default readabilityChecker;
