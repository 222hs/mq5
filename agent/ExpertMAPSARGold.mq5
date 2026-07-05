//+------------------------------------------------------------------+
//|                                              ExpertMAPSARGold.mq5|
//|                          Gold (XAUUSD) optimized — MA + PSAR     |
//|                          Based on MetaQuotes ExpertMAPSAR        |
//+------------------------------------------------------------------+
#property copyright "GoldScalperX"
#property link      "https://www.mql5.com"
#property version   "1.00"

#include <Expert\Expert.mqh>
#include <Expert\Signal\SignalMA.mqh>
#include <Expert\Trailing\TrailingParabolicSAR.mqh>
#include <Expert\Money\MoneySizeOptimized.mqh>

//--- Expert
input string             Inp_Expert_Title         = "ExpertMAPSARGold";
int                      Expert_MagicNumber       = 38471;
bool                     Expert_EveryTick         = false;

//--- Signal (MA)
input int                Inp_MA_Period            = 6;          // MA Period (أقصر للـ M1)
input int                Inp_MA_Shift             = 3;          // MA Shift
input ENUM_MA_METHOD     Inp_MA_Method            = MODE_EMA;   // EMA أسرع استجابة
input ENUM_APPLIED_PRICE Inp_MA_Applied           = PRICE_CLOSE;

//--- Trailing (Parabolic SAR)
input double             Inp_SAR_Step             = 0.01;       // أضيق للذهب المتذبذب
input double             Inp_SAR_Maximum          = 0.10;

//--- Money
input double             Inp_DecreaseFactor       = 3.0;
input double             Inp_Percent              = 2.0;        // 2% بدل 10% (الذهب خطر)

//--- Gold filters
input int                Inp_MaxSpread            = 40;         // أقصى سبريد مقبول (نقاط)
input bool               Inp_UseSessionFilter     = true;       // فلتر الجلسات
input int                Inp_SessionStart         = 7;          // بداية جلسة لندن (UTC)
input int                Inp_SessionEnd           = 21;         // نهاية جلسة نيويورك (UTC)

//+------------------------------------------------------------------+
CExpert ExtExpert;
bool    g_filtersOK = true;

//+------------------------------------------------------------------+
bool CheckGoldFilters()
  {
   // فلتر السبريد
   long spread = SymbolInfoInteger(Symbol(), SYMBOL_SPREAD);
   if(spread > Inp_MaxSpread) return false;

   // فلتر الجلسات
   if(Inp_UseSessionFilter)
     {
      MqlDateTime dt;
      TimeToStruct(TimeGMT(), dt);
      if(dt.hour < Inp_SessionStart || dt.hour >= Inp_SessionEnd) return false;
     }

   return true;
  }

//+------------------------------------------------------------------+
int OnInit(void)
  {
   if(!ExtExpert.Init(Symbol(), Period(), Expert_EveryTick, Expert_MagicNumber))
     { printf(__FUNCTION__+": error initializing expert"); ExtExpert.Deinit(); return(-1); }

   // Signal
   CSignalMA *signal = new CSignalMA;
   if(signal == NULL)
     { printf(__FUNCTION__+": error creating signal"); ExtExpert.Deinit(); return(-2); }
   if(!ExtExpert.InitSignal(signal))
     { printf(__FUNCTION__+": error initializing signal"); ExtExpert.Deinit(); return(-3); }
   signal.PeriodMA(Inp_MA_Period);
   signal.Shift(Inp_MA_Shift);
   signal.Method(Inp_MA_Method);
   signal.Applied(Inp_MA_Applied);
   if(!signal.ValidationSettings())
     { printf(__FUNCTION__+": error signal parameters"); ExtExpert.Deinit(); return(-4); }

   // Trailing
   CTrailingPSAR *trailing = new CTrailingPSAR;
   if(trailing == NULL)
     { printf(__FUNCTION__+": error creating trailing"); ExtExpert.Deinit(); return(-5); }
   if(!ExtExpert.InitTrailing(trailing))
     { printf(__FUNCTION__+": error initializing trailing"); ExtExpert.Deinit(); return(-6); }
   trailing.Step(Inp_SAR_Step);
   trailing.Maximum(Inp_SAR_Maximum);
   if(!trailing.ValidationSettings())
     { printf(__FUNCTION__+": error trailing parameters"); ExtExpert.Deinit(); return(-7); }

   // Money
   CMoneySizeOptimized *money = new CMoneySizeOptimized;
   if(money == NULL)
     { printf(__FUNCTION__+": error creating money"); ExtExpert.Deinit(); return(-8); }
   if(!ExtExpert.InitMoney(money))
     { printf(__FUNCTION__+": error initializing money"); ExtExpert.Deinit(); return(-9); }
   money.DecreaseFactor(Inp_DecreaseFactor);
   money.Percent(Inp_Percent);
   if(!money.ValidationSettings())
     { printf(__FUNCTION__+": error money parameters"); ExtExpert.Deinit(); return(-10); }

   if(!ExtExpert.InitIndicators())
     { printf(__FUNCTION__+": error initializing indicators"); ExtExpert.Deinit(); return(-11); }

   Print("ExpertMAPSARGold initialized | Symbol=", Symbol(),
         " MA=", Inp_MA_Period, "/", Inp_MA_Shift,
         " SAR=", Inp_SAR_Step, "/", Inp_SAR_Maximum,
         " MaxSpread=", Inp_MaxSpread);
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   ExtExpert.Deinit();
  }

//+------------------------------------------------------------------+
void OnTick(void)
  {
   // فلاتر الذهب — لو ما تنجح، لا يدخل صفقات جديدة
   g_filtersOK = CheckGoldFilters();
   if(!g_filtersOK) return;

   ExtExpert.OnTick();
  }

//+------------------------------------------------------------------+
void OnTrade(void)
  {
   ExtExpert.OnTrade();
  }

//+------------------------------------------------------------------+
void OnTimer(void)
  {
   ExtExpert.OnTimer();
  }
//+------------------------------------------------------------------+
