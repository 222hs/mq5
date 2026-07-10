//+------------------------------------------------------------------+
//|                                              BreakoutGrid.mq5     |
//|   Breakout Grid Trading Bot (Buy Stop / Sell Stop grid)          |
//|   - Straddles current price with pending STOP orders both sides  |
//|   - Dynamic re-centering, global TP/SL, trailing, opp-cancel     |
//+------------------------------------------------------------------+
#property copyright "BreakoutGrid"
#property version   "1.00"
#property strict

#include <Trade/Trade.mqh>
#include <Trade/PositionInfo.mqh>
#include <Trade/OrderInfo.mqh>

//================= CONFIGURABLE PARAMETERS =========================
input group "=== Grid Setup ==="
input int      InpGridLevels      = 10;     // Orders per side (Buy Stops above / Sell Stops below)
input double   InpStepPoints      = 100;    // Spacing between each grid level (points)
input double   InpFirstDistPoints = 100;    // Distance from price to the FIRST order (points)
input double   InpLotSize         = 0.01;   // Fixed lot size for every order
input long     InpMagic           = 990100; // Magic number (bot identity)

input group "=== Dynamic Maintenance ==="
input bool     InpRecenter        = true;   // Re-center the grid when price drifts (no triggers)
input double   InpRecenterPoints  = 150;    // Price move (points) before re-centering
input int      InpMinRegridSec    = 3;      // Min seconds between grid rebuilds (rate-limit guard)

input group "=== Global Risk / Exits ==="
input double   InpTargetProfitUSD = 10.0;   // Close ALL when total profit >= this $ (0=off)
input double   InpMaxLossUSD      = 20.0;   // Close ALL when total loss <= -this $ (0=off)
input double   InpTargetPct       = 0.0;    // ...or profit >= this % of balance (0=off)
input double   InpMaxLossPct      = 0.0;    // ...or loss >= this % of balance (0=off)

input group "=== Trailing Stop ==="
input bool     InpUseTrailing     = true;   // Trail SL on triggered positions
input double   InpTrailStartPoints= 150;    // Start trailing after +X points profit
input double   InpTrailStepPoints = 100;    // Trail distance behind price (points)

input group "=== Options ==="
input bool     InpOppositeCancel  = true;   // When one side triggers, cancel the other side's pendings
input int      InpMaxSpreadPoints = 500;    // Skip placing grid if spread wider than this
input int      InpOrderExpiryMin  = 0;      // Pending order expiry (minutes, 0 = GTC)

//================= GLOBAL STATE ====================================
CTrade         trade;
CPositionInfo  posInfo;
COrderInfo     ordInfo;
double         g_point;
int            g_digits;
double         g_gridCenter = 0.0;    // mid price at last grid placement
bool           g_gridActive = false;
datetime       g_lastGrid   = 0;      // throttle for rebuilds

//================= LOGGING =========================================
void Log(const string m){ Print("[BGrid] ", m); }

//================= INIT / DEINIT ===================================
int OnInit()
  {
   g_point  = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   g_digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(30);
   trade.SetAsyncMode(false);
   Log("Init | levels="+(string)InpGridLevels+" step="+DoubleToString(InpStepPoints,0)+
       "pts first="+DoubleToString(InpFirstDistPoints,0)+"pts lot="+DoubleToString(InpLotSize,2)+
       " magic="+(string)InpMagic);
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason){ Log("Deinit reason="+(string)reason); }

//================= COUNTERS ========================================
int CountPending(const ENUM_ORDER_TYPE type)
  {
   int n=0;
   for(int i=OrdersTotal()-1;i>=0;i--)
      if(ordInfo.SelectByIndex(i))
         if(ordInfo.Symbol()==_Symbol && ordInfo.Magic()==InpMagic && ordInfo.OrderType()==type) n++;
   return n;
  }
int CountPositions(const int typeFilter) // -1 = any, else POSITION_TYPE_*
  {
   int n=0;
   for(int i=PositionsTotal()-1;i>=0;i--)
      if(posInfo.SelectByIndex(i))
         if(posInfo.Symbol()==_Symbol && posInfo.Magic()==InpMagic)
            if(typeFilter<0 || (int)posInfo.PositionType()==typeFilter) n++;
   return n;
  }

//================= ORDER SENDERS (with retry) ======================
bool SendStop(const bool isBuy, double price)
  {
   price = NormalizeDouble(price, g_digits);
   datetime exp = (InpOrderExpiryMin>0) ? TimeCurrent()+InpOrderExpiryMin*60 : 0;
   ENUM_ORDER_TYPE_TIME tt = (InpOrderExpiryMin>0) ? ORDER_TIME_SPECIFIED : ORDER_TIME_GTC;

   for(int attempt=0; attempt<3; attempt++)
     {
      bool ok = isBuy
                ? trade.BuyStop (InpLotSize, price, _Symbol, 0.0, 0.0, tt, exp, "BGRID")
                : trade.SellStop(InpLotSize, price, _Symbol, 0.0, 0.0, tt, exp, "BGRID");
      if(ok)
        {
         Log((isBuy?"BuyStop":"SellStop")+" @ "+DoubleToString(price,g_digits)+
             "  ticket="+(string)trade.ResultOrder());
         return true;
        }
      uint rc = trade.ResultRetcode();
      // transient errors → retry after a short pause
      if(rc==TRADE_RETCODE_REQUOTE || rc==TRADE_RETCODE_PRICE_CHANGED ||
         rc==TRADE_RETCODE_TIMEOUT || rc==TRADE_RETCODE_PRICE_OFF ||
         rc==TRADE_RETCODE_CONNECTION || rc==TRADE_RETCODE_TOO_MANY_REQUESTS)
        { Sleep(200); continue; }
      Log((isBuy?"BuyStop":"SellStop")+" FAIL @ "+DoubleToString(price,g_digits)+
          "  rc="+(string)rc+" "+trade.ResultRetcodeDescription());
      return false;
     }
   return false;
  }

//================= CANCEL / CLOSE ==================================
void CancelPending(const bool buys, const bool sells)
  {
   for(int i=OrdersTotal()-1;i>=0;i--)
     {
      if(!ordInfo.SelectByIndex(i)) continue;
      if(ordInfo.Symbol()!=_Symbol || ordInfo.Magic()!=InpMagic) continue;
      ENUM_ORDER_TYPE t = ordInfo.OrderType();
      if((buys && t==ORDER_TYPE_BUY_STOP) || (sells && t==ORDER_TYPE_SELL_STOP))
         if(!trade.OrderDelete(ordInfo.Ticket()))
            Log("OrderDelete FAIL #"+(string)ordInfo.Ticket()+" rc="+(string)trade.ResultRetcode());
     }
  }

void CloseAllPositions()
  {
   for(int i=PositionsTotal()-1;i>=0;i--)
     {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Symbol()!=_Symbol || posInfo.Magic()!=InpMagic) continue;
      ulong tk=posInfo.Ticket();
      if(trade.PositionClose(tk))
         Log("CLOSE #"+(string)tk+" profit=$"+DoubleToString(posInfo.Profit(),2));
      else
         Log("PositionClose FAIL #"+(string)tk+" rc="+(string)trade.ResultRetcode());
     }
  }

//================= P&L ============================================
double TotalProfit()
  {
   double p=0.0;
   for(int i=PositionsTotal()-1;i>=0;i--)
      if(posInfo.SelectByIndex(i))
         if(posInfo.Symbol()==_Symbol && posInfo.Magic()==InpMagic)
            p += posInfo.Profit()+posInfo.Swap()+posInfo.Commission();
   return p;
  }

//================= GRID PLACEMENT ==================================
void PlaceGrid()
  {
   long spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   if(spread > InpMaxSpreadPoints){ Log("spread "+(string)spread+" > max — skip grid"); return; }

   CancelPending(true, true);                       // clear any old pendings first

   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   long   stops = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   // stop orders must sit at least STOPS_LEVEL away from price
   double firstD = MathMax(InpFirstDistPoints, (double)stops+1) * g_point;
   double step   = MathMax(InpStepPoints, 1.0) * g_point;

   int placed=0;
   for(int i=0;i<InpGridLevels;i++)
     {
      double buyP  = ask + firstD + i*step;        // Buy Stops ABOVE ask
      double sellP = bid - firstD - i*step;        // Sell Stops BELOW bid
      if(sellP <= 0) continue;
      if(SendStop(true,  buyP))  placed++;
      if(SendStop(false, sellP)) placed++;
     }
   g_gridCenter = (ask+bid)*0.5;
   g_gridActive = (placed>0);
   g_lastGrid   = TimeCurrent();
   Log("GRID placed "+(string)placed+" orders around "+DoubleToString(g_gridCenter,g_digits)+
       " (spread="+(string)spread+")");
  }

//================= GLOBAL EXIT ====================================
bool CheckGlobalExit()
  {
   int pos = CountPositions(-1);
   if(pos==0) return false;                          // nothing to protect

   double profit = TotalProfit();
   double bal    = AccountInfoDouble(ACCOUNT_BALANCE);
   double tpUSD  = (InpTargetPct>0) ? bal*InpTargetPct/100.0 : InpTargetProfitUSD;
   double slUSD  = (InpMaxLossPct >0) ? bal*InpMaxLossPct /100.0 : InpMaxLossUSD;

   if(tpUSD>0 && profit>=tpUSD)
     {
      Log("★ GLOBAL TP: $"+DoubleToString(profit,2)+" >= $"+DoubleToString(tpUSD,2)+" — flat all");
      CloseAllPositions(); CancelPending(true,true); g_gridActive=false; return true;
     }
   if(slUSD>0 && profit<=-slUSD)
     {
      Log("☠ GLOBAL SL: $"+DoubleToString(profit,2)+" <= -$"+DoubleToString(slUSD,2)+" — flat all");
      CloseAllPositions(); CancelPending(true,true); g_gridActive=false; return true;
     }
   return false;
  }

//================= TRAILING STOP ==================================
void ApplyTrailing()
  {
   if(!InpUseTrailing) return;
   double startD = InpTrailStartPoints*g_point;
   double stepD  = InpTrailStepPoints *g_point;

   for(int i=PositionsTotal()-1;i>=0;i--)
     {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Symbol()!=_Symbol || posInfo.Magic()!=InpMagic) continue;
      ulong  tk   = posInfo.Ticket();
      double open = posInfo.PriceOpen();
      double sl   = posInfo.StopLoss();
      double tp   = posInfo.TakeProfit();

      if(posInfo.PositionType()==POSITION_TYPE_BUY)
        {
         double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
         if(bid-open >= startD)
           {
            double newSL = NormalizeDouble(bid-stepD, g_digits);
            if(newSL > sl && newSL < bid)
               if(trade.PositionModify(tk,newSL,tp))
                  Log("TRAIL BUY #"+(string)tk+" SL→"+DoubleToString(newSL,g_digits));
           }
        }
      else // SELL
        {
         double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
         if(open-ask >= startD)
           {
            double newSL = NormalizeDouble(ask+stepD, g_digits);
            if((sl==0.0 || newSL < sl) && newSL > ask)
               if(trade.PositionModify(tk,newSL,tp))
                  Log("TRAIL SELL #"+(string)tk+" SL→"+DoubleToString(newSL,g_digits));
           }
        }
     }
  }

//================= OPPOSITE-GRID CANCELLATION =====================
void CheckOppositeCancel()
  {
   if(!InpOppositeCancel) return;
   int buys  = CountPositions(POSITION_TYPE_BUY);
   int sells = CountPositions(POSITION_TYPE_SELL);
   // a BUY triggered and no SELL open → free margin: cancel the sell-stop side
   if(buys>0 && sells==0 && CountPending(ORDER_TYPE_SELL_STOP)>0)
     { CancelPending(false,true); Log("BUY triggered → cancelled Sell-Stop grid"); }
   if(sells>0 && buys==0 && CountPending(ORDER_TYPE_BUY_STOP)>0)
     { CancelPending(true,false); Log("SELL triggered → cancelled Buy-Stop grid"); }
  }

//================= DYNAMIC RE-CENTER ==============================
void MaintainGrid()
  {
   if(!InpRecenter) return;
   if(CountPositions(-1)>0) return;                 // something triggered → don't disturb
   if(TimeCurrent()-g_lastGrid < InpMinRegridSec) return; // throttle rebuilds

   double mid = (SymbolInfoDouble(_Symbol,SYMBOL_ASK)+SymbolInfoDouble(_Symbol,SYMBOL_BID))*0.5;
   if(MathAbs(mid-g_gridCenter) >= InpRecenterPoints*g_point)
     {
      Log("price drifted "+DoubleToString(MathAbs(mid-g_gridCenter)/g_point,0)+"pts — re-centering");
      PlaceGrid();
     }
  }

//================= MAIN LOOP ======================================
void OnTick()
  {
   // 1) global protective exit first
   if(CheckGlobalExit()) return;

   // 2) manage what has already triggered
   CheckOppositeCancel();
   ApplyTrailing();

   // 3) grid lifecycle
   int pend = CountPending(ORDER_TYPE_BUY_STOP)+CountPending(ORDER_TYPE_SELL_STOP);
   int pos  = CountPositions(-1);

   if(pend==0 && pos==0)
     {
      // no grid and nothing open → (re)build the straddle
      if(TimeCurrent()-g_lastGrid >= InpMinRegridSec) PlaceGrid();
      return;
     }
   // grid still pending, price may have drifted with no fills → re-center
   MaintainGrid();
  }
//+------------------------------------------------------------------+
