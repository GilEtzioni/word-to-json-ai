import OpenAI from "openai";

const openai = new OpenAI();

export const removePrefix = {

  async process_document(
    categories: any[], 
    fields: { field: string; type: string }[]
  ): Promise<{ cleaned_items: any[]; prefixFound: Record<string, string | null> }> {
    
    const flatItems = categories.flatMap(cat => cat.items || []);
    
    // 1. Handle Empty Case: Return the specific object structure to prevent crashes
    if (flatItems.length === 0) {
        return { cleaned_items: categories, prefixFound: {} };
    }

    const fieldNames = fields.map(f => f.field);

    // 2. Get the prefixes
    const prefixMap = await this._getPrefixesFromAI(flatItems, fieldNames);

    // 3. Clean the data using the map
    const cleanedData = this._cleanData(categories, prefixMap, fieldNames);

    // 4. Return both the cleaned data and the prefix map
    return { 
        cleaned_items: cleanedData, 
        prefixFound: prefixMap 
    };
  },

  async _getPrefixesFromAI(sampleItems: any[], fieldNames: string[]): Promise<Record<string, string | null>> {
    const sample = JSON.stringify(sampleItems.slice(0, 3));
    
    const prompt = `
      TASK: Identify the REPEATED LABEL/PREFIX used at the start of these fields: ${fieldNames.join(", ")}.
      
      Look for patterns like:
      - Typos: "Q uestion"
      - Symbols: "• Question"
      - Plurals: "Questions"
      - Hebrew: "שאלה"
      
      DATA:
      ${sample}

      Return ONLY a JSON object where keys are the field names and values are the EXACT prefix text identified.
    `;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a data cleaning expert. Return only JSON." },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" }
    });

    return JSON.parse(response.choices[0].message.content || "{}");
  },

  _cleanData(categories: any[], prefixMap: Record<string, string | null>, fieldNames: string[]): any[] {
    return categories.map(category => ({
      ...category,
      items: (category.items || []).map((item: any) => {
        const cleanedItem = { ...item };
        
        fieldNames.forEach(field => {
          const value = cleanedItem[field];
          const prefix = prefixMap[field];

          if (Array.isArray(value)) {
            cleanedItem[field] = value
              .map(subItem => 
                typeof subItem === 'string' ? this._applyStringCleaning(subItem, prefix) : subItem
              )
              .filter((subItem: any) => subItem !== "");
          } 
          else if (typeof value === 'string') {
            cleanedItem[field] = this._applyStringCleaning(value, prefix);
          }
        });
        
        return cleanedItem;
      })
    }));
  },

  _applyStringCleaning(text: string, prefix: string | null): string {
    if (!text) return text;

    if (prefix) {
      const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const prefixRegex = new RegExp(`^[\\s•\\-]*${escaped}s?[\\s\\n]*[:;=-]?[\\s\\n]*[•\\-]*[\\s\\n]*`, 'i');
      text = text.replace(prefixRegex, '');
    }

    text = text.replace(/^[\s•\-\*]+/, ''); 
    text = text.replace(/^\d+[\.\)]\s*/, '');
    text = text.replace(/^[\s•\-\*]+/, '');

    return text.trim();
  }
}