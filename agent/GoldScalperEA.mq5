//+------------------------------------------------------------------+
//|                                        GoldScalperX_v5.mq5       |
//|                Fast & Smart Multi-Symbol Scalping EA             |
//+------------------------------------------------------------------+
#property copyright "GoldScalperX"
#property version   "5.00"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

input double          LotSize       = 0.01;
input int             MaxSpread     = 500;
input int             RSI_Period    = 7;
input int             EMA_Fast      = 8;
input int             EMA_Slow      = 21;
input int             ATR_Period    = 14;
input double          ATR_SL_Mult   = 1.5;   // SL = ATR × هذا
input double          ATR_TP_Mult   = 2.0;   // TP = ATR × هذا
input bool            UseTrailing   = true;
input double          TrailATR_Mult = 1.0;
input int             MaxPositions  = 3;
input int             CooldownSecs  = 30;    // ثواني بين الصفقات
input ENUM_TIMEFRAMES TF            = PERIOD_M1;

#define BOT_NAME    "GoldScalperX"
#define DASH_PREFIX "GSX_"
#define GV_PREFIX   "GSX_"

int      g_magic = 0;
CTrade        trade;
CPositionInfo posInfo;

int hRSI=INVALID_HANDLE, hEMAFast=INVALID_HANDLE;
int hEMASlow=INVALID_HANDLE, hATR=INVALID_HANDLE;

double g_rsi=0, g_emaFast=0, g_emaSlow=0, g_atr=0;

double g_LotSize=0.01, g_slMult=1.5, g_tpMult=2.0, g_trailMult=1.0;
int    g_MaxSpread=500, g_MaxPos=3, g_cooldown=30;

string   g_lastSignal="NONE";
datetime g_lastSignalTime=0, g_lastTradeTime=0;
int      g_totalTrades=0;
bool     g_running=false;

//+------------------------------------------------------------------+
int MagicFromSymbol(string sym)
  {
   int h=100000;
   for(int i=0;i<StringLen(sym);i++) h=h*31+(int)StringGetCharacter(sym,i);
   return MathAbs(h)%900000+100000;
  }

double GV(string key,double fb){ return GlobalVariableCheck(GV_PREFIX+key)?GlobalVariableGet(GV_PREFIX+key):fb; }

void LoadSettings()
  {
   g_LotSize    = GV("LotSize",     LotSize);
   g_MaxSpread  = (int)GV("MaxSpread",   MaxSpread);
   g_MaxPos     = (int)GV("MaxPositions",MaxPositions);
   g_slMult     = GV("ATR_SL_Mult",  ATR_SL_Mult);
   g_tpMult     = GV("ATR_TP_Mult",  ATR_TP_Mult);
   g_trailMult  = GV("TrailATR_Mult",TrailATR_Mult);
   g_cooldown   = (int)GV("CooldownSecs",CooldownSecs);
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   g_magic=MagicFromSymbol(_Symbol);
   trade.SetExpertMagicNumber(g_magic);
   trade.SetDeviationInPoints(30);
   trade.SetTypeFillingBySymbol(_Symbol);

   hRSI     = iRSI(_Symbol,TF,RSI_Period,PRICE_CLOSE);
   hEMAFast = iMA(_Symbol,TF,EMA_Fast,0,MODE_EMA,PRICE_CLOSE);
   hEMASlow = iMA(_Symbol,TF,EMA_Slow,0,MODE_EMA,PRICE_CLOSE);
   hATR     = iATR(_Symbol,TF,ATR_Period);

   if(hRSI==INVALID_HANDLE||hEMAFast==INVALID_HANDLE||hEMASlow==INVALID_HANDLE||hATR==INVALID_HANDLE)
     { Print(BOT_NAME,"[",_Symbol,"]: FAILED handles"); return(INIT_FAILED); }

   LoadSettings();
   g_running=true;
   CreateDashboard();
   Print(BOT_NAME,"[",_Symbol,"]: INIT v5 | Magic=",g_magic," TF=",EnumToString(TF),
         " | SL×",ATR_SL_Mult," TP×",ATR_TP_Mult," Trail=",UseTrailing);
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason)
  {
   g_running=false;
   IndicatorRelease(hRSI); IndicatorRelease(hEMAFast);
   IndicatorRelease(hEMASlow); IndicatorRelease(hATR);
   ObjectsDeleteAll(0,DASH_PREFIX);
   ChartRedraw();
   Print(BOT_NAME,"[",_Symbol,"]: STOPPED | Trades=",g_totalTrades);
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   if(!UpdateIndicators()) { UpdateDashboard(); return; }

   LoadSettings();

   // Trailing Stop على كل تيك
   if(UseTrailing) ManageTrailing();

   long spread=SymbolInfoInteger(_Symbol,SYMBOL_SPREAD);
   if(spread>g_MaxSpread) { UpdateDashboard(); return; }

   // Cooldown بين الصفقات
   if(TimeCurrent()-g_lastTradeTime < g_cooldown) { UpdateDashboard(); return; }

   // قراءة آخر شمعتين مغلقتين
   double o1=iOpen(_Symbol,TF,1), c1=iClose(_Symbol,TF,1);
   double h1=iHigh(_Symbol,TF,1), l1=iLow(_Symbol,TF,1);
   double o2=iOpen(_Symbol,TF,2), c2=iClose(_Symbol,TF,2);

   double range1 = h1-l1;
   double body1  = MathAbs(c1-o1);
   // شمعة قوية: body أكبر من 50% من المدى الكلي
   bool strongCandle = (range1>0 && body1/range1>=0.5);

   bool bull1=(c1>o1), bear1=(c1<o1);
   bool bull2=(c2>o2), bear2=(c2<o2);

   bool buySignal  = bull1 && bull2 && strongCandle
                  && g_emaFast>g_emaSlow
                  && g_rsi>45.0 && g_rsi<75.0;

   bool sellSignal = bear1 && bear2 && strongCandle
                  && g_emaFast<g_emaSlow
                  && g_rsi>25.0 && g_rsi<55.0;

   bool hasBuy=false, hasSell=false;
   for(int i=PositionsTotal()-1;i>=0;i--)
     {
      if(posInfo.SelectByIndex(i)&&posInfo.Symbol()==_Symbol&&posInfo.Magic()==g_magic)
        {
         if(posInfo.PositionType()==POSITION_TYPE_BUY)  hasBuy=true;
         if(posInfo.PositionType()==POSITION_TYPE_SELL) hasSell=true;
        }
     }

   int totalOpen=OpenPositionsCount();

   if(buySignal && totalOpen<g_MaxPos)
     {
      if(hasSell) CloseAllPositions(POSITION_TYPE_SELL);
      OpenPosition(ORDER_TYPE_BUY);
     }
   else if(sellSignal && totalOpen<g_MaxPos)
     {
      if(hasBuy) CloseAllPositions(POSITION_TYPE_BUY);
      OpenPosition(ORDER_TYPE_SELL);
     }

   UpdateDashboard();
  }

//+------------------------------------------------------------------+
bool UpdateIndicators()
  {
   double r[1],f[1],s[1],a[1];
   if(CopyBuffer(hRSI,    0,1,1,r)<1) return false;
   if(CopyBuffer(hEMAFast,0,1,1,f)<1) return false;
   if(CopyBuffer(hEMASlow,0,1,1,s)<1) return false;
   if(CopyBuffer(hATR,    0,1,1,a)<1) return false;
   g_rsi=r[0]; g_emaFast=f[0]; g_emaSlow=s[0]; g_atr=a[0];
   return true;
  }

//+------------------------------------------------------------------+
void OpenPosition(ENUM_ORDER_TYPE type)
  {
   double point   = SymbolInfoDouble(_Symbol,SYMBOL_POINT);
   long   stopLvl = SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL);
   double minDist = (stopLvl+5)*point;
   double slDist  = MathMax(g_atr*g_slMult, minDist);
   double tpDist  = MathMax(g_atr*g_tpMult, minDist);

   double price,sl,tp;
   if(type==ORDER_TYPE_BUY)
     {
      price=SymbolInfoDouble(_Symbol,SYMBOL_ASK);
      sl=NormalizeDouble(price-slDist,_Digits);
      tp=NormalizeDouble(price+tpDist,_Digits);
      if(trade.Buy(g_LotSize,_Symbol,price,sl,tp,BOT_NAME))
        {
         g_totalTrades++; g_lastSignal="BUY";
         g_lastSignalTime=TimeCurrent(); g_lastTradeTime=TimeCurrent();
         Print(BOT_NAME,"[",_Symbol,"]: BUY @ ",DoubleToString(price,_Digits),
               " SL=",DoubleToString(sl,_Digits)," TP=",DoubleToString(tp,_Digits),
               " ATR=",DoubleToString(g_atr,_Digits));
        }
      else Print(BOT_NAME,"[",_Symbol,"]: BUY FAILED | ",trade.ResultRetcodeDescription());
     }
   else
     {
      price=SymbolInfoDouble(_Symbol,SYMBOL_BID);
      sl=NormalizeDouble(price+slDist,_Digits);
      tp=NormalizeDouble(price-tpDist,_Digits);
      if(trade.Sell(g_LotSize,_Symbol,price,sl,tp,BOT_NAME))
        {
         g_totalTrades++; g_lastSignal="SELL";
         g_lastSignalTime=TimeCurrent(); g_lastTradeTime=TimeCurrent();
         Print(BOT_NAME,"[",_Symbol,"]: SELL @ ",DoubleToString(price,_Digits),
               " SL=",DoubleToString(sl,_Digits)," TP=",DoubleToString(tp,_Digits),
               " ATR=",DoubleToString(g_atr,_Digits));
        }
      else Print(BOT_NAME,"[",_Symbol,"]: SELL FAILED | ",trade.ResultRetcodeDescription());
     }
  }

//+------------------------------------------------------------------+
void ManageTrailing()
  {
   double point   = SymbolInfoDouble(_Symbol,SYMBOL_POINT);
   long   stopLvl = SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL);
   double minDist = (stopLvl+5)*point;
   double trail   = MathMax(g_atr*g_trailMult, minDist);

   for(int i=PositionsTotal()-1;i>=0;i--)
     {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Symbol()!=_Symbol||posInfo.Magic()!=g_magic) continue;
      ulong  ticket=posInfo.Ticket();
      double curSL=posInfo.StopLoss();
      if(posInfo.PositionType()==POSITION_TYPE_BUY)
        {
         double bid=SymbolInfoDouble(_Symbol,SYMBOL_BID);
         double newSL=NormalizeDouble(bid-trail,_Digits);
         if(newSL>curSL+point) trade.PositionModify(ticket,newSL,posInfo.TakeProfit());
        }
      else
        {
         double ask=SymbolInfoDouble(_Symbol,SYMBOL_ASK);
         double newSL=NormalizeDouble(ask+trail,_Digits);
         if(curSL==0||newSL<curSL-point) trade.PositionModify(ticket,newSL,posInfo.TakeProfit());
        }
     }
  }

//+------------------------------------------------------------------+
void CloseAllPositions(ENUM_POSITION_TYPE type)
  {
   for(int i=PositionsTotal()-1;i>=0;i--)
     {
      if(posInfo.SelectByIndex(i)&&posInfo.Symbol()==_Symbol&&
         posInfo.Magic()==g_magic&&posInfo.PositionType()==type)
        {
         ulong t=posInfo.Ticket(); double p=posInfo.Profit();
         if(trade.PositionClose(t))
            Print(BOT_NAME,"[",_Symbol,"]: CLOSED Ticket=",t," P=",DoubleToString(p,2),"$");
        }
     }
  }

int OpenPositionsCount()
  {
   int c=0;
   for(int i=PositionsTotal()-1;i>=0;i--)
      if(posInfo.SelectByIndex(i)&&posInfo.Symbol()==_Symbol&&posInfo.Magic()==g_magic) c++;
   return c;
  }

double FloatingProfit()
  {
   double p=0;
   for(int i=PositionsTotal()-1;i>=0;i--)
      if(posInfo.SelectByIndex(i)&&posInfo.Symbol()==_Symbol&&posInfo.Magic()==g_magic)
         p+=posInfo.Profit()+posInfo.Swap();
   return p;
  }

//+------------------------------------------------------------------+
void CreatePanel(string name,int x,int y,int w,int h)
  {
   ObjectCreate(0,name,OBJ_RECTANGLE_LABEL,0,0,0);
   ObjectSetInteger(0,name,OBJPROP_CORNER,CORNER_LEFT_UPPER);
   ObjectSetInteger(0,name,OBJPROP_XDISTANCE,x); ObjectSetInteger(0,name,OBJPROP_YDISTANCE,y);
   ObjectSetInteger(0,name,OBJPROP_XSIZE,w);      ObjectSetInteger(0,name,OBJPROP_YSIZE,h);
   ObjectSetInteger(0,name,OBJPROP_BGCOLOR,C'18,18,28');
   ObjectSetInteger(0,name,OBJPROP_BORDER_COLOR,clrDimGray);
   ObjectSetInteger(0,name,OBJPROP_BORDER_TYPE,BORDER_FLAT);
   ObjectSetInteger(0,name,OBJPROP_BACK,false);
   ObjectSetInteger(0,name,OBJPROP_SELECTABLE,false);
   ObjectSetInteger(0,name,OBJPROP_HIDDEN,true);
  }

void CreateLabel(string name,int x,int y)
  {
   ObjectCreate(0,name,OBJ_LABEL,0,0,0);
   ObjectSetInteger(0,name,OBJPROP_CORNER,CORNER_LEFT_UPPER);
   ObjectSetInteger(0,name,OBJPROP_XDISTANCE,x); ObjectSetInteger(0,name,OBJPROP_YDISTANCE,y);
   ObjectSetInteger(0,name,OBJPROP_FONTSIZE,9);
   ObjectSetString(0,name,OBJPROP_FONT,"Consolas");
   ObjectSetInteger(0,name,OBJPROP_COLOR,clrWhite);
   ObjectSetInteger(0,name,OBJPROP_SELECTABLE,false);
   ObjectSetInteger(0,name,OBJPROP_HIDDEN,true);
  }

void SetLabel(int idx,string text,color clr)
  {
   string name=DASH_PREFIX+"L"+IntegerToString(idx);
   ObjectSetString(0,name,OBJPROP_TEXT,text);
   ObjectSetInteger(0,name,OBJPROP_COLOR,clr);
  }

void CreateDashboard()
  {
   CreatePanel(DASH_PREFIX+"BG",10,20,305,345);
   for(int i=0;i<16;i++) CreateLabel(DASH_PREFIX+"L"+IntegerToString(i),20,30+i*20);
   UpdateDashboard();
  }

void UpdateDashboard()
  {
   long   spread=SymbolInfoInteger(_Symbol,SYMBOL_SPREAD);
   double profit=FloatingProfit();
   int    openCnt=OpenPositionsCount();

   string trend; color trendClr;
   if(g_emaFast>g_emaSlow)      { trend="BULLISH"; trendClr=clrLime; }
   else if(g_emaFast<g_emaSlow) { trend="BEARISH"; trendClr=clrRed; }
   else                         { trend="NEUTRAL";  trendClr=clrWhite; }

   color rsiClr  = (g_rsi>45&&g_rsi<75&&g_emaFast>g_emaSlow)?clrLime
                 : (g_rsi>25&&g_rsi<55&&g_emaFast<g_emaSlow)?clrRed:clrWhite;
   color profClr = profit>0?clrLime:profit<0?clrRed:clrWhite;
   color sprdClr = spread>g_MaxSpread?clrRed:clrLime;
   bool  usingGV = GlobalVariableCheck(GV_PREFIX+"LotSize");

   string lastSig=g_lastSignal;
   if(g_lastSignalTime>0) lastSig+=" @ "+TimeToString(g_lastSignalTime,TIME_MINUTES|TIME_SECONDS);

   long coolLeft=(long)g_cooldown-(long)(TimeCurrent()-g_lastTradeTime);
   string coolStr = coolLeft>0?("Cooldown : "+IntegerToString((int)coolLeft)+"s"):"Ready    : ✓";
   color  coolClr = coolLeft>0?clrOrange:clrLime;

   SetLabel(0,  "★ "+BOT_NAME+" ["+_Symbol+"] v5 ★",                                   clrGold);
   SetLabel(1,  "TF: "+EnumToString(TF)+" | Magic: "+IntegerToString(g_magic),          clrSilver);
   SetLabel(2,  "Status  : "+(g_running?"RUNNING":"STOPPED"),                           g_running?clrLime:clrRed);
   SetLabel(3,  "Settings: "+(usingGV?"Dashboard ✓":"Local defaults"),                 usingGV?clrLime:clrYellow);
   SetLabel(4,  "─────────────────────────",                                            clrDimGray);
   SetLabel(5,  "EMA"+IntegerToString(EMA_Fast)+": "+DoubleToString(g_emaFast,2)
               +" | EMA"+IntegerToString(EMA_Slow)+": "+DoubleToString(g_emaSlow,2),   clrDeepSkyBlue);
   SetLabel(6,  "RSI: "+DoubleToString(g_rsi,1)+" | ATR: "+DoubleToString(g_atr,_Digits), rsiClr);
   SetLabel(7,  "Trend   : "+trend,                                                     trendClr);
   SetLabel(8,  "─────────────────────────",                                            clrDimGray);
   SetLabel(9,  "Signal  : "+lastSig,                                                   g_lastSignal=="BUY"?clrLime:g_lastSignal=="SELL"?clrRed:clrWhite);
   SetLabel(10, coolStr,                                                                 coolClr);
   SetLabel(11, "Lot: "+DoubleToString(g_LotSize,2)
               +" SL×"+DoubleToString(g_slMult,1)
               +" TP×"+DoubleToString(g_tpMult,1)
               +" Tr×"+DoubleToString(g_trailMult,1),                                  clrSilver);
   SetLabel(12, "─────────────────────────",                                            clrDimGray);
   SetLabel(13, "Open    : "+IntegerToString(openCnt)+" / "+IntegerToString(g_MaxPos),  clrWhite);
   SetLabel(14, "P/L     : "+DoubleToString(profit,2)+" USD",                          profClr);
   SetLabel(15, "Spread  : "+IntegerToString((int)spread)+" | Total: "+IntegerToString(g_totalTrades), sprdClr);
   ChartRedraw();
  }
//+------------------------------------------------------------------+
